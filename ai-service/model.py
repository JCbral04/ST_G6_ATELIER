"""ATELIER: forecasting with historical sales only, no database writes."""
import math
from datetime import timedelta
from statistics import mean, pstdev
from sklearn.linear_model import Ridge


def features(history, day):
    # Only observations strictly before the day being predicted.
    def ema(span):
        a = 2 / (span + 1)
        value = history[0]
        for v in history[1:]:
            value = a * v + (1 - a) * value
        return value
    return [ema(7), ema(14), math.sin(2*math.pi*day.weekday()/7),
            math.cos(2*math.pi*day.weekday()/7)]


def ridge_forecast(values, dates, days):
    x = [features(values[:i], dates[i]) for i in range(7, len(values))]
    y = values[7:]
    model = Ridge(alpha=1.0).fit(x, y)
    history = list(values)
    predictions = []
    for i in range(days):
        day = dates[-1] + timedelta(days=i+1)
        prediction = max(0.0, float(model.predict([features(history, day)])[0]))
        predictions.append(prediction)
        history.append(prediction)
    return predictions


def ses(values):
    level = values[0]
    for v in values[1:]:
        level = .3*v + .7*level
    return float(level)


def recommend(rows, today, horizon=15, lead=7, z=1.65):
    """rows include sales by day, stock, category, pending purchase quantity."""
    series = []
    category_rates = {}
    for row in rows:
        sales = {k: int(v) for k, v in (row['ventas'] or {}).items()}
        dates = [today-timedelta(days=i) for i in range(90,0,-1)]
        values = [sales.get(d.isoformat(), 0) for d in dates]
        first = next((i for i,v in enumerate(values) if v>0), len(values))
        dates, values = dates[first:], values[first:]
        series.append((row, dates, values))
        if len(values)>=7:
            category_rates.setdefault(row['categoria'],[]).append(mean(values))
    result = []
    for row, dates, values in series:
        stock, transit = int(row['stock']),int(row['transito'])
        n=len(values)
        mae=None
        if n>=21:
            preds=ridge_forecast(values, dates,horizon)
            # Holdout: final seven historical days, trained only on earlier dates.
            hold=ridge_forecast(values[:-7],dates[:-7],7)
            mae=mean(abs(a-b) for a,b in zip(values[-7:],hold))
            method='ridge'
        elif n>=7:
            preds=[ses(values)]*horizon
            method='suavizado_exponencial'
        else:
            peers=category_rates.get(row['categoria'],[])
            if peers:
                preds=[mean(peers)]*horizon
                method='estimacion_categoria'
            elif values:
                preds=[mean(values)]*horizon
                method='historial_insuficiente'
            else:
                preds=None
                method='umbral_estatico_sin_historial'
        base={k:row[k] for k in ('id_variante','sku','producto','categoria','stock','stock_minimo','transito')}
        if preds is None:
            result.append(dict(base,modelo=method,dias_observados=n,mae_validacion=None,demanda_diaria=None,cobertura_dias=None,stock_seguridad=None,punto_reorden=None,cantidad_sugerida=max(0,int(row['stock_minimo'])-stock-transit),riesgo='SIN_HISTORIAL'))
            continue
        demand=float(mean(preds))
        sigma=pstdev(values) if len(values)>1 else 0.0
        safety=z*sigma*math.sqrt(lead)
        reorder=sum(preds[:lead])+safety
        coverage=stock/demand if demand>0 else None
        risk='CRITICO' if coverage is not None and coverage<lead else ('ALTO' if stock+transit<reorder else ('MEDIO' if coverage is not None and coverage<horizon else 'BAJO'))
        result.append(dict(base,modelo=method,dias_observados=n,mae_validacion=round(mae,3) if mae is not None else None,demanda_diaria=round(demand,3),cobertura_dias=round(coverage,2) if coverage is not None else None,stock_seguridad=round(safety,2),punto_reorden=round(reorder,2),cantidad_sugerida=max(0,math.ceil(sum(preds)+safety-stock-transit-1e-9)),riesgo=risk))
    return result
