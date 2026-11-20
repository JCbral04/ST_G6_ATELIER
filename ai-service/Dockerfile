FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY ai-service/requirements.txt ./requirements.txt

RUN python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip check \
    && groupadd --system atelier \
    && useradd --system --gid atelier --no-create-home atelier

COPY --chown=atelier:atelier ai-service/main.py ai-service/database.py ai-service/model.py ./

USER atelier

EXPOSE 8000

CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
