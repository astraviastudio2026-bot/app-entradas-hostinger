require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./src/db');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- rutas ----
app.use('/api', require('./src/routes/auth'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/phases', require('./src/routes/phases'));
app.use('/api/tickets', require('./src/routes/tickets'));
app.use('/api/scan', require('./src/routes/scan'));
app.use('/api/reports', require('./src/routes/reports'));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', service: 'flags-fest-backend' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador global de errores
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`FLAGS FEST backend escuchando en http://localhost:${PORT}`);
});
