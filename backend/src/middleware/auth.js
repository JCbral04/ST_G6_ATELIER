
const { createHash } = require('node:crypto');
const { pool } = require('../config/db');

const hashToken = (token) =>
  createHash('sha256').update(token).digest('hex');

async function autenticar(req, res, next) {
  const header = req.get('Authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);

  if (!match) {
    return res.status(401).json({
      error: 'Autenticación requerida'
    });
  }

  try {
    const result = await pool.query(
      `SELECT u.id_usuario, u.nombre, u.rol
       FROM sesion_usuario s
       JOIN usuario u ON u.id_usuario = s.id_usuario
       WHERE s.token_hash = $1
         AND s.fecha_revocacion IS NULL
         AND s.fecha_expiracion > NOW()`,
      [hashToken(match[1])]
    );

    if (result.rows.length !== 1) {
      return res.status(401).json({
        error: 'Sesión inválida o expirada'
      });
    }

    req.usuario = result.rows[0];
    req.tokenHash = hashToken(match[1]);
    return next();
  } catch (err) {
    console.error('Error de autenticación:', err);
    return res.status(500).json({
      error: 'Error al verificar la sesión'
    });
  }
}

function permitirRoles(...roles) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({
        error: 'Autenticación requerida'
      });
    }

    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({
        error: 'No tienes permisos para esta operación'
      });
    }

    return next();
  };
}

module.exports = { autenticar, permitirRoles, hashToken };
