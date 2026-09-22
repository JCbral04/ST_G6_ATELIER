require('dotenv').config();

const express = require('express');
const routes = require('./src/routes');
const { testConnection } = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api', routes);

app.listen(PORT, async () => {
  await testConnection();
  console.log(`ATELIER API en http://localhost:${PORT}/api`);
});