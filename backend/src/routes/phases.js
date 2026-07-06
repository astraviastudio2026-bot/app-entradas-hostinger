const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { ah } = require('../utils');

const router = express.Router();
router.use(requireAuth);

// Fase vigente segun la fecha actual (usada tambien al vender).
async function getActivePhase(conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, name, price, start_date, end_date
     FROM sale_phases
     WHERE is_active = 1 AND NOW() BETWEEN start_date AND end_date
     ORDER BY start_date DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

router.get('/current', ah(async (req, res) => {
  const phase = await getActivePhase();
  res.json({ phase });
}));

router.get('/', ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.price, p.start_date, p.end_date, p.is_active,
            COALESCE(SUM(t.status <> 'cancelled'), 0) AS tickets_sold
     FROM sale_phases p
     LEFT JOIN tickets t ON t.phase_id = p.id
     GROUP BY p.id
     ORDER BY p.start_date ASC`
  );
  const current = await getActivePhase();
  res.json({ phases: rows, current_phase_id: current ? current.id : null });
}));

function validatePhase(body) {
  const { name, price, start_date: start, end_date: end } = body || {};
  if (!name || !String(name).trim()) return 'El nombre es obligatorio';
  const priceNum = Number(price);
  if (Number.isNaN(priceNum) || priceNum < 0) return 'El precio debe ser un número mayor o igual a 0';
  if (!start || !end) return 'Las fechas de inicio y fin son obligatorias';
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'Fechas inválidas';
  if (s >= e) return 'La fecha de inicio debe ser anterior a la fecha de fin';
  return null;
}

router.post('/', requireAdmin, ah(async (req, res) => {
  const error = validatePhase(req.body);
  if (error) return res.status(400).json({ error });
  const { name, price, start_date: start, end_date: end, is_active: active } = req.body;
  const [dup] = await pool.query('SELECT id FROM sale_phases WHERE name = ?', [String(name).trim()]);
  if (dup.length) return res.status(409).json({ error: 'Ya existe una fase con ese nombre' });
  const [result] = await pool.query(
    'INSERT INTO sale_phases (name, price, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?)',
    [String(name).trim(), Number(price), new Date(start), new Date(end), active === false ? 0 : 1]
  );
  res.status(201).json({ id: result.insertId, message: 'Fase creada' });
}));

router.put('/:id', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const error = validatePhase(req.body);
  if (error) return res.status(400).json({ error });
  const { name, price, start_date: start, end_date: end, is_active: active } = req.body;
  const [dup] = await pool.query('SELECT id FROM sale_phases WHERE name = ? AND id <> ?', [String(name).trim(), id]);
  if (dup.length) return res.status(409).json({ error: 'Ya existe otra fase con ese nombre' });
  const [result] = await pool.query(
    'UPDATE sale_phases SET name = ?, price = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?',
    [String(name).trim(), Number(price), new Date(start), new Date(end), active === false ? 0 : 1, id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Fase no encontrada' });
  res.json({ message: 'Fase actualizada' });
}));

router.patch('/:id/status', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const isActive = req.body && req.body.is_active ? 1 : 0;
  const [result] = await pool.query('UPDATE sale_phases SET is_active = ? WHERE id = ?', [isActive, id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Fase no encontrada' });
  res.json({ message: isActive ? 'Fase activada' : 'Fase desactivada' });
}));

module.exports = router;
module.exports.getActivePhase = getActivePhase;
