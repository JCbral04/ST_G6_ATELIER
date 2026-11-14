
const { Router } = require('express');
const { randomBytes } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { autenticar, hashToken } = require('../middleware/auth');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiados intentos de inicio de sesión'
  }
});

// Limitar las operaciones autenticadas para reducir abuso y consultas excesivas
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes, intenta más tarde'
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { correo, contrasena } = req.body || {};

  if (
    typeof correo !== 'string' ||
    typeof contrasena !== 'string' ||
    correo.length > 120 ||
    contrasena.length === 0 ||
    contrasena.length > 1024
  ) {
    return res.status(400).json({
      error: 'Credenciales inválidas'
    });
  }

  try {
    const result = await pool.query(
      `SELECT id_usuario, nombre, rol
       FROM usuario
       WHERE correo = $1
         AND contrasena_hash = crypt($2, contrasena_hash)`,
      [correo.trim().toLowerCase(), contrasena]
    );

    if (result.rows.length !== 1) {
      return res.status(401).json({
        error: 'Correo o contraseña incorrectos'
      });
    }

    const usuario = result.rows[0];
    const token = randomBytes(32).toString('base64url');

    await pool.query(
      `INSERT INTO sesion_usuario
         (id_usuario, token_hash, fecha_expiracion)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [usuario.id_usuario, hashToken(token)]
    );

    res.set('Cache-Control', 'no-store');

    return res.status(200).json({
      token,
      tipo: 'Bearer',
      expira_en: 3600,
      usuario
    });
  } catch (err) {
    console.error('Error de inicio de sesión:', err);
    return res.status(500).json({
      error: 'No se pudo iniciar sesión'
    });
  }
});

router.get('/me', authLimiter, autenticar, (req, res) => {
  res.set('Cache-Control', 'no-store');

  return res.status(200).json({
    usuario: req.usuario
  });
});

router.post('/logout', authLimiter, autenticar, async (req, res) => {
  try {
    await pool.query(
      `UPDATE sesion_usuario
       SET fecha_revocacion = NOW()
       WHERE token_hash = $1
         AND fecha_revocacion IS NULL`,
      [req.tokenHash]
    );

    return res.status(200).json({
      mensaje: 'Sesión cerrada'
    });
  } catch (err) {
    console.error('Error al cerrar sesión:', err);
    return res.status(500).json({
      error: 'No se pudo cerrar la sesión'
    });
  }
});

module.exports = router;
