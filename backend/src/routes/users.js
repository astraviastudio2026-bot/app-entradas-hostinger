const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, requireAdmin, isValidEmail } = require('../middleware');
const { ah } = require('../utils');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const USER_FIELDS = `
  u.id, u.name, u.email, u.role, u.quota, u.is_active, u.created_at,
  COALESCE(t.sold_count, 0)   AS sold_count,
  COALESCE(t.used_count, 0)   AS used_count,
  COALESCE(t.revenue, 0)      AS revenue
`;
const USER_JOIN = `
  LEFT JOIN (
    SELECT seller_id,
           SUM(status <> 'cancelled')            AS sold_count,
           SUM(status = 'used')                  AS used_count,
           SUM(IF(status <> 'cancelled', price, 0)) AS revenue
    FROM tickets GROUP BY seller_id
  ) t ON t.seller_id = u.id
`;

router.get('/', ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ${USER_FIELDS} FROM users u ${USER_JOIN} ORDER BY u.role = 'admin' DESC, u.name ASC`
  );
  res.json({ users: rows });
}));

router.post('/', ah(async (req, res) => {
  const { name, email, password, quota } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Correo inválido' });
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const quotaNum = Number(quota);
  if (!Number.isInteger(quotaNum) || quotaNum < 0) {
    return res.status(400).json({ error: 'El cupo debe ser un número entero mayor o igual a 0' });
  }
  const [dup] = await pool.query('SELECT id FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (dup.length) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });

  const hash = bcrypt.hashSync(String(password), 10);
  const [result] = await pool.query(
    "INSERT INTO users (name, email, password_hash, role, quota, is_active) VALUES (?, ?, ?, 'seller', ?, 1)",
    [String(name).trim(), String(email).trim().toLowerCase(), hash, quotaNum]
  );
  res.status(201).json({ id: result.insertId, message: 'Vendedor creado' });
}));

router.put('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { name, email, password, quota } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Correo inválido' });
  const quotaNum = Number(quota);
  if (!Number.isInteger(quotaNum) || quotaNum < 0) {
    return res.status(400).json({ error: 'El cupo debe ser un número entero mayor o igual a 0' });
  }
  const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ?', [
    String(email).trim().toLowerCase(), id,
  ]);
  if (dup.length) return res.status(409).json({ error: 'Ya existe otro usuario con ese correo' });

  const params = [String(name).trim(), String(email).trim().toLowerCase(), quotaNum];
  let sql = 'UPDATE users SET name = ?, email = ?, quota = ?';
  if (password) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    sql += ', password_hash = ?';
    params.push(bcrypt.hashSync(String(password), 10));
  }
  sql += ' WHERE id = ?';
  params.push(id);
  await pool.query(sql, params);
  res.json({ message: 'Usuario actualizado' });
}));

router.patch('/:id/status', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  }
  const isActive = req.body && req.body.is_active ? 1 : 0;
  const [result] = await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [isActive, id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ message: isActive ? 'Usuario activado' : 'Usuario desactivado' });
}));

module.exports = router;
