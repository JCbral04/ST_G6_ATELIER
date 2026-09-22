const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'atelier_db',
});

// Verifica la conexión al iniciar el servidor
async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW() AS conexion_ok');
    console.log('PostgreSQL conectado:', res.rows[0].conexion_ok);
  } catch (err) {
    console.error('Error de conexión a PostgreSQL:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };