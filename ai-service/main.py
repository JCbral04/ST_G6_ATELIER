import hmac
import logging
import os
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
from database import fetch_rows
from model import recommend

app = FastAPI(title='ATELIER AI', version='0.1.0', docs_url=None, redoc_url=None, openapi_url=None)

class Parameters(BaseModel):
    horizon_days: int = Field(default=15, ge=1, le=30)
    lead_days: int = Field(default=7, ge=1, le=30)
    service_level_z: float = Field(default=1.65, ge=0, le=3)

    @model_validator(mode='after')
    def check_horizon(self):
        if self.horizon_days < self.lead_days:
            raise ValueError('horizon_days debe ser >= lead_days')
        return self

@app.get('/health')
def health():
    return {'servicio':'atelier-ai','estado':'activo'}

@app.post('/api/v1/predict/restock')
def restock(params: Parameters, x_internal_api_key: str = Header(default='')):
    key=os.getenv('AI_INTERNAL_KEY','')
    if not key:
        raise HTTPException(503,'Servicio sin configurar')
    if not hmac.compare_digest(key.encode(),x_internal_api_key.encode()):
        raise HTTPException(401,'No autorizado')
    try:
        rows,today=fetch_rows()
        items=recommend(rows,today,params.horizon_days,params.lead_days,params.service_level_z)
    except Exception:
        logging.exception('Error de análisis de reposición')
        raise HTTPException(503,'Análisis no disponible')
    return {'modo':'prediccion','fecha_corte':today.isoformat(),'horizonte_dias':params.horizon_days,'lead_dias':params.lead_days,'nivel_z':params.service_level_z,'advertencias':['Demanda observada, no corrige censura por desabastecimiento.','Tiempo de entrega supuesto y común a todos los SKU.','MAE solo disponible para Ridge con validación temporal.','Recomendaciones no crean órdenes de compra.'], 'items':items}
