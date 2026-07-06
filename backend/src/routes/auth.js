const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, getSetting } = require('../db');
const { signToken, requireAuth, isValidEmail } = require('../middleware');
const { ah } = require('../utils');

const router = express.Router();

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
  }
  const [rows] = await pool.query(
    'SELECT id, name, email, password_hash, role, quota, is_active FROM users WHERE email = ?',
    [String(email).trim().toLowerCase()]
  );
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta al administrador.' });
  }
  const token = signToken(user);
  const currency = await getSetting('currency_symbol', 'S/');
  return res.json({
    token,
    currency,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, quota: user.quota },
  });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, quota, is_active FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!rows.length || !rows[0].is_active) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
  const currency = await getSetting('currency_symbol', 'S/');
  return res.json({ user: rows[0], currency });
}));

module.exports = router;
