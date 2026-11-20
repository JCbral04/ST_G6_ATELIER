const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  const url = new URL(databaseUrl);

  if (url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error(
      'DATABASE_URL requiere sslmode=verify-full'
    );
  }
}

const config = databaseUrl
  ? {
      connectionString: databaseUrl,
      enableChannelBinding: true,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
      max: 5,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'atelier_db',
    };

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('Error en el pool PostgreSQL:', err.code || err.name);
});

async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW() AS conexion_ok');
    console.log('PostgreSQL conectado:', res.rows[0].conexion_ok);
  } catch (err) {
    console.error(
      'Error de conexion a PostgreSQL:',
      err.code || err.name
    );
    process.exit(1);
  }
}

module.exports = { pool, testConnection };
