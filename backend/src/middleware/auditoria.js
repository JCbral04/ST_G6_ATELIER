const { pool } = require('../config/db');

/**
 * Registra un evento en la bitácora de auditoría (RNF-09).
 * Acepta un `client` transaccional o usa `pool` por defecto.
 */
async function registrarAuditoria(db, { id_usuario, accion, entidad, id_entidad = null, detalle = {} }) {
  const executor = db || pool;
  await executor.query(
    `INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad, detalle)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [id_usuario, accion, entidad, id_entidad, JSON.stringify(detalle || {})]
  );
}

/**
 * Middleware reutilizable para auditar operaciones HTTP exitosas (2xx),
 * como creación o edición de productos y variantes.
 */
function auditarOperacion({ accion, entidad, obtenerIdEntidad, obtenerDetalle }) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      if (!req.usuario || !req.usuario.id_usuario) return;

      const id_entidad = typeof obtenerIdEntidad === 'function' ? obtenerIdEntidad(req, res) : null;
      const detalle = typeof obtenerDetalle === 'function' ? obtenerDetalle(req, res) : {};

      registrarAuditoria(pool, {
        id_usuario: req.usuario.id_usuario,
        accion,
        entidad,
        id_entidad,
        detalle,
      }).catch((err) => {
        console.error('Error al registrar auditoría desde middleware:', err.message);
      });
    });

    return next();
  };
}

module.exports = { registrarAuditoria, auditarOperacion };