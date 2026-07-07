require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { pool } = require('./src/db');

const app = express();
app.disable('x-powered-by');
// Detrás de Nginx: necesario para que express-rate-limit y las cookies
// Secure vean la IP y el protocolo reales.
app.set('trust proxy', 1);

app.use(helmet());

// CORS restringido al dominio propio (y al dev server de Vite en local).
const allowedOrigins = [process.env.APP_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // Sin cabecera Origin (same-origin, curl) se permite.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ---- rutas ----
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/tickets', require('./src/routes/tickets'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/public', require('./src/routes/public'));       // compra web pública (sin login)
app.use('/api/purchases', require('./src/routes/purchases')); // revisión de pagos (admin/organizador)

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', service: 'flags-fest-backend' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador global de errores: loguea el stack, nunca lo expone.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`FLAGS FEST backend escuchando en http://localhost:${PORT}`);
});
