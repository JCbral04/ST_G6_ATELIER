/**
 * Registra un evento en la bitácora de auditoría (RNF-09).
 * Debe ejecutarse dentro de la misma transacción (`client`) antes del COMMIT
 * para garantizar atomicidad entre la operación crítica y su trazabilidad.
 */
async function registrarAuditoria(client, { id_usuario, accion, entidad, id_entidad = null, detalle = {} }) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('registrarAuditoria requiere un cliente transaccional activo');
  }

  await client.query(
    `INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad, detalle)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [id_usuario, accion, entidad, id_entidad, JSON.stringify(detalle || {})]
  );
}

module.exports = { registrarAuditoria };