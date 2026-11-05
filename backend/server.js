require('dotenv').config();

const path = require('path');
const express = require('express');
const routes = require('./src/routes');
const { testConnection } = require('./src/config/db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', routes);

// JSON mal formado: responde 400 en JSON en vez de la página de error con el stack trace
app.use('/api', (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' });
  }
  next(err);
});

// Interfaz web (issue #8): http://localhost:3000/
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.listen(PORT, async () => {
  await testConnection();
  console.log(`ATELIER API en http://localhost:${PORT}/api`);
});