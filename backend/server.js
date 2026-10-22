require('dotenv').config();

const path = require('path');
const express = require('express');
const routes = require('./src/routes');
const { testConnection } = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', routes);

// Interfaz web (issue #8): http://localhost:3000/
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.listen(PORT, async () => {
  await testConnection();
  console.log(`ATELIER API en http://localhost:${PORT}/api`);
});