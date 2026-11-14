
-- ATELIER: sesiones autenticadas y revocables
CREATE TABLE IF NOT EXISTS sesion_usuario (
    id_sesion BIGSERIAL PRIMARY KEY,
    id_usuario INT NOT NULL
        REFERENCES usuario(id_usuario) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_expiracion TIMESTAMPTZ NOT NULL,
    fecha_revocacion TIMESTAMPTZ,
    CONSTRAINT chk_expiracion_sesion
        CHECK (fecha_expiracion > fecha_creacion)
);

CREATE INDEX IF NOT EXISTS idx_sesion_usuario_activa
ON sesion_usuario (token_hash, fecha_expiracion)
WHERE fecha_revocacion IS NULL;
