const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth, setSessionCookie, clearSessionCookie } = require('../middleware');
const { ah, normalizeUsername } = require('../utils');

const router = express.Router();

const REDIRECTS = { admin: '/admin', seller: '/seller', validator: '/scanner' };

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Inténtalo de nuevo en unos minutos.' },
});

router.post('/login', loginLimiter, ah(async (req, res) => {
  const { username, password } = req.body || {};
  const user = normalizeUsername(username);
  if (!user || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }

  const [rows] = await pool.query(
    'SELECT id, full_name, username, email, role, is_active, password_hash FROM users WHERE username = ?',
    [user]
  );
  const found = rows[0];
  // Mensaje genérico: no revelar si el usuario existe o está inactivo.
  if (!found || !bcrypt.compareSync(password, found.password_hash) || !found.is_active) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  setSessionCookie(res, found);
  return res.json({
    ok: true,
    redirectTo: REDIRECTS[found.role] || '/',
    user: { id: found.id, full_name: found.full_name, username: found.username, role: found.role },
  });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, ah(async (req, res) => {
  const { id, full_name: fullName, username, email, role } = req.user;
  res.json({
    user: { id, full_name: fullName, username, email, role },
    redirectTo: REDIRECTS[role] || '/',
  });
}));

module.exports = router;
