from datetime import date,timedelta
from fastapi.testclient import TestClient
import pytest
import main
from model import recommend

TODAY=date(2026,11,19)

def row(n=30, stock=4, transit=0, sku='A'):
    return dict(id_variante=1,sku=sku,producto='Camisa',categoria='Camisetas',stock=stock,stock_minimo=5,transito=transit,ventas={(TODAY-timedelta(days=i)).isoformat():3 for i in range(1,n+1)})

def test_ridge_constant():
    v=recommend([row()],TODAY)[0]
    assert v['modelo']=='ridge' and v['demanda_diaria']==3 and v['mae_validacion']==0
    assert v['cantidad_sugerida']==41

def test_transit():
    assert recommend([row(transit=50)],TODAY)[0]['cantidad_sugerida']==0

def test_moderate():
    assert recommend([row(10)],TODAY)[0]['modelo']=='suavizado_exponencial'

def test_cold_no_data():
    v=recommend([row(0,stock=0)],TODAY)[0]
    assert v['demanda_diaria'] is None and v['cantidad_sugerida']==5

def test_cold_category():
    r=recommend([row(10),row(0,sku='B')],TODAY)[1]
    assert r['modelo']=='estimacion_categoria' and r['demanda_diaria']==3

def test_api_rejects_bad_key(monkeypatch):
    monkeypatch.setenv('AI_INTERNAL_KEY','test-key')
    assert TestClient(main.app).post('/api/v1/predict/restock',json={}).status_code==401

def test_api_returns_prediction(monkeypatch):
    monkeypatch.setenv('AI_INTERNAL_KEY','test-key')
    monkeypatch.setattr(main,'fetch_rows',lambda:([row()],TODAY))
    res=TestClient(main.app).post('/api/v1/predict/restock',headers={'X-Internal-API-Key':'test-key'},json={})
    assert res.status_code==200 and res.json()['items'][0]['modelo']=='ridge'

def test_horizon_validation(monkeypatch):
    monkeypatch.setenv('AI_INTERNAL_KEY','test-key')
    res=TestClient(main.app).post('/api/v1/predict/restock',headers={'X-Internal-API-Key':'test-key'},json={'horizon_days':2,'lead_days':7})
    assert res.status_code==422
