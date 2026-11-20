-- ATELIER: bitácora de auditoría de operaciones críticas (RNF-09)
CREATE TABLE IF NOT EXISTS auditoria (
    id          BIGSERIAL PRIMARY KEY,
    id_usuario  INT         NOT NULL REFERENCES usuario(id_usuario),
    accion      VARCHAR(30) NOT NULL,
    entidad     VARCHAR(50) NOT NULL,
    id_entidad  INT,
    detalle     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON auditoria (entidad);