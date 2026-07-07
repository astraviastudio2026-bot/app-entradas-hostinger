const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { ah, uuid, normalizeUsername, isValidEmail } = require('../utils');
const { ecDayStartUtc, ecDayEndUtc, DATE_RE } = require('../time');
const { getActiveEvent, getCurrentPhase } = require('../queries');
const { audit } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const ROLES = ['admin', 'seller', 'validator'];

// ------------------------------------------------------------
// Usuarios
// ------------------------------------------------------------
router.get('/users', ah(async (req, res) => {
  const event = await getActiveEvent();
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.email, u.role, u.is_active, u.created_at,
            a.allocated_quantity,
            COALESCE(t.sold_count, 0) AS sold_count,
            COALESCE(t.revenue, 0)    AS revenue
     FROM users u
     LEFT JOIN seller_allocations a ON a.seller_id = u.id AND a.event_id = ?
     LEFT JOIN (
       SELECT seller_id,
              SUM(status <> 'cancelled')               AS sold_count,
              SUM(IF(status <> 'cancelled', price, 0)) AS revenue
       FROM tickets WHERE event_id = ? GROUP BY seller_id
     ) t ON t.seller_id = u.id
     ORDER BY FIELD(u.role, 'admin', 'seller', 'validator'), u.full_name ASC`,
    [event ? event.id : null, event ? event.id : null]
  );
  res.json({ users: rows, event_id: event ? event.id : null });
}));

router.post('/users', ah(async (req, res) => {
  const { full_name: fullName, password, role, email } = req.body || {};
  const username = normalizeUsername(req.body && req.body.username);

  if (!fullName || String(fullName).trim().length < 3 || String(fullName).trim().length > 120) {
    return res.status(422).json({ error: 'El nombre completo debe tener entre 3 y 120 caracteres' });
  }
  if (!username || username.length < 3 || username.length > 60 || !/^[a-z0-9._-]+$/.test(username)) {
    return res.status(422).json({ error: 'Usuario inválido: usa 3-60 caracteres (letras, números, punto, guion)' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(422).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  if (!ROLES.includes(role)) {
    return res.status(422).json({ error: 'Rol inválido (admin, seller o validator)' });
  }
  if (email && !isValidEmail(email)) {
    return res.status(422).json({ error: 'Correo inválido' });
  }

  const [dup] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (dup.length) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });

  const id = uuid();
  await pool.query(
    'INSERT INTO users (id, full_name, username, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [id, String(fullName).trim(), username, email ? String(email).trim().toLowerCase() : null,
      bcrypt.hashSync(password, 12), role]
  );
  await audit(pool, { actorId: req.user.id, action: 'user.create', entityType: 'user', entityId: id, metadata: { username, role } });
  res.status(201).json({ ok: true, id, message: `Usuario ${username} creado` });
}));

router.post('/users/:id/toggle', ah(async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(409).json({ error: 'No puedes desactivar tu propia cuenta' });
  }
  const [rows] = await pool.query('SELECT id, username, is_active FROM users WHERE id = ?', [id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const newState = user.is_active ? 0 : 1;
  await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newState, id]);
  await audit(pool, {
    actorId: req.user.id,
    action: newState ? 'user.activate' : 'user.deactivate',
    entityType: 'user',
    entityId: id,
    metadata: { username: user.username },
  });
  res.json({ ok: true, is_active: Boolean(newState), message: newState ? 'Usuario activado' : 'Usuario desactivado' });
}));

// ------------------------------------------------------------
// Evento (upsert; solo un evento activo a la vez)
// ------------------------------------------------------------
router.get('/events', ah(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM events ORDER BY created_at DESC');
  const active = rows.find((e) => e.is_active) || null;
  res.json({ events: rows, active_event: active });
}));

router.post('/events', ah(async (req, res) => {
  const { id, name, location, event_date: eventDate, total_tickets: totalTickets, is_active: isActive } = req.body || {};
  if (!name || String(name).trim().length < 3 || String(name).trim().length > 160) {
    return res.status(422).json({ error: 'El nombre del evento debe tener entre 3 y 160 caracteres' });
  }
  if (!DATE_RE.test(String(eventDate || ''))) {
    return res.status(422).json({ error: 'La fecha del evento debe tener formato AAAA-MM-DD' });
  }
  const total = Number(totalTickets);
  if (!Number.isInteger(total) || total < 1 || total > 100000) {
    return res.status(422).json({ error: 'El total de entradas debe ser un entero mayor a 0' });
  }
  const active = isActive === false ? 0 : 1;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let eventId = id || null;
    if (eventId) {
      const [result] = await conn.query(
        'UPDATE events SET name = ?, location = ?, event_date = ?, total_tickets = ?, is_active = ? WHERE id = ?',
        [String(name).trim(), location ? String(location).trim() : null, eventDate, total, active, eventId]
      );
      if (!result.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ error: 'Evento no encontrado' });
      }
    } else {
      eventId = uuid();
      await conn.query(
        'INSERT INTO events (id, name, location, event_date, total_tickets, is_active) VALUES (?, ?, ?, ?, ?, ?)',
        [eventId, String(name).trim(), location ? String(location).trim() : null, eventDate, total, active]
      );
    }
    // Un solo evento activo a la vez
    if (active) {
      await conn.query('UPDATE events SET is_active = 0 WHERE id <> ?', [eventId]);
    }
    await conn.commit();
    await audit(pool, {
      actorId: req.user.id,
      action: id ? 'event.update' : 'event.create',
      entityType: 'event',
      entityId: eventId,
      metadata: { name: String(name).trim(), event_date: eventDate, total_tickets: total },
    });
    res.status(id ? 200 : 201).json({ ok: true, id: eventId, message: 'Evento guardado' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// ------------------------------------------------------------
// Fases de venta (fechas YYYY-MM-DD en día de Ecuador -> UTC)
// ------------------------------------------------------------
router.get('/phases', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.json({ phases: [], current_phase_id: null });
  const [rows] = await pool.query(
    `SELECT p.*, COALESCE(SUM(t.status <> 'cancelled'), 0) AS tickets_sold
     FROM sale_phases p
     LEFT JOIN tickets t ON t.sale_phase_id = p.id
     WHERE p.event_id = ?
     GROUP BY p.id
     ORDER BY p.phase_order ASC`,
    [event.id]
  );
  const current = await getCurrentPhase(event.id);
  res.json({ phases: rows, current_phase_id: current ? current.id : null, event_id: event.id });
}));

router.post('/phases', ah(async (req, res) => {
  const {
    id, name, phase_order: phaseOrder, start_date: startDate, end_date: endDate, price, is_active: isActive,
  } = req.body || {};

  const event = await getActiveEvent();
  if (!event) return res.status(409).json({ error: 'No hay evento activo configurado.' });

  if (!name || !String(name).trim() || String(name).trim().length > 80) {
    return res.status(422).json({ error: 'El nombre de la fase es obligatorio (máx. 80 caracteres)' });
  }
  const orderNum = Number(phaseOrder);
  if (!Number.isInteger(orderNum) || orderNum < 1) {
    return res.status(422).json({ error: 'El orden de la fase debe ser un entero mayor o igual a 1' });
  }
  const priceNum = Number(price);
  if (Number.isNaN(priceNum) || priceNum < 0) {
    return res.status(422).json({ error: 'El precio debe ser un número mayor o igual a 0' });
  }
  const startsAt = ecDayStartUtc(startDate);
  const endsAt = ecDayEndUtc(endDate);
  if (!startsAt || !endsAt) {
    return res.status(422).json({ error: 'Las fechas deben tener formato AAAA-MM-DD' });
  }
  if (String(endDate) < String(startDate)) {
    return res.status(422).json({ error: 'La fecha de fin debe ser igual o posterior a la de inicio' });
  }
  const active = isActive === false ? 0 : 1;

  if (id) {
    const [result] = await pool.query(
      `UPDATE sale_phases SET name = ?, phase_order = ?, starts_at = ?, ends_at = ?, price = ?, is_active = ?
       WHERE id = ? AND event_id = ?`,
      [String(name).trim(), orderNum, startsAt, endsAt, priceNum, active, id, event.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Fase no encontrada' });
    await audit(pool, { actorId: req.user.id, action: 'phase.update', entityType: 'sale_phase', entityId: id, metadata: { name, price: priceNum } });
    return res.json({ ok: true, id, message: 'Fase actualizada' });
  }

  const phaseId = uuid();
  await pool.query(
    `INSERT INTO sale_phases (id, event_id, name, phase_order, starts_at, ends_at, price, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [phaseId, event.id, String(name).trim(), orderNum, startsAt, endsAt, priceNum, active]
  );
  await audit(pool, { actorId: req.user.id, action: 'phase.create', entityType: 'sale_phase', entityId: phaseId, metadata: { name, price: priceNum } });
  return res.status(201).json({ ok: true, id: phaseId, message: 'Fase creada' });
}));

// ------------------------------------------------------------
// Cupos por vendedor (upsert por evento activo + vendedor)
// ------------------------------------------------------------
router.get('/allocations', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.json({ allocations: [] });
  const [rows] = await pool.query(
    `SELECT a.id, a.seller_id, a.allocated_quantity, u.full_name, u.username, u.is_active,
            COALESCE(t.sold_count, 0) AS sold_count
     FROM seller_allocations a
     JOIN users u ON u.id = a.seller_id
     LEFT JOIN (
       SELECT seller_id, SUM(status <> 'cancelled') AS sold_count
       FROM tickets WHERE event_id = ? GROUP BY seller_id
     ) t ON t.seller_id = a.seller_id
     WHERE a.event_id = ?
     ORDER BY u.full_name ASC`,
    [event.id, event.id]
  );
  res.json({ allocations: rows, event_id: event.id });
}));

router.post('/allocations', ah(async (req, res) => {
  const { seller_id: sellerId, allocated_quantity: quantity } = req.body || {};
  const qty = Number(quantity);
  if (!sellerId) return res.status(422).json({ error: 'Falta el vendedor' });
  if (!Number.isInteger(qty) || qty < 0) {
    return res.status(422).json({ error: 'El cupo debe ser un entero mayor o igual a 0' });
  }

  const event = await getActiveEvent();
  if (!event) return res.status(409).json({ error: 'No hay evento activo configurado.' });

  const [sellers] = await pool.query("SELECT id, role FROM users WHERE id = ?", [sellerId]);
  if (!sellers.length) return res.status(404).json({ error: 'Vendedor no encontrado' });
  if (sellers[0].role !== 'seller') {
    return res.status(422).json({ error: 'Solo se asignan cupos a usuarios con rol vendedor' });
  }

  await pool.query(
    `INSERT INTO seller_allocations (id, event_id, seller_id, allocated_quantity)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE allocated_quantity = VALUES(allocated_quantity)`,
    [uuid(), event.id, sellerId, qty]
  );
  await audit(pool, {
    actorId: req.user.id,
    action: 'allocation.upsert',
    entityType: 'seller_allocation',
    entityId: sellerId,
    metadata: { event_id: event.id, allocated_quantity: qty },
  });
  res.json({ ok: true, message: 'Cupo guardado' });
}));

// ------------------------------------------------------------
// Dashboard de administración
// ------------------------------------------------------------
router.get('/dashboard', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) {
    return res.json({ event: null, phase: null, metrics: null, message: 'No hay evento activo configurado.' });
  }
  const phase = await getCurrentPhase(event.id);

  const [[totals]] = await pool.query(
    `SELECT SUM(status <> 'cancelled')                  AS sold,
            SUM(status = 'used')                        AS used,
            SUM(status = 'cancelled')                   AS cancelled,
            COALESCE(SUM(IF(status <> 'cancelled', price, 0)), 0) AS revenue
     FROM tickets WHERE event_id = ?`,
    [event.id]
  );
  const [byColor] = await pool.query(
    `SELECT selected_color AS color, SUM(status <> 'cancelled') AS sold
     FROM tickets WHERE event_id = ? GROUP BY selected_color`,
    [event.id]
  );
  const [byPhase] = await pool.query(
    `SELECT p.id, p.name, p.price,
            COALESCE(SUM(t.status <> 'cancelled'), 0) AS sold,
            COALESCE(SUM(IF(t.status <> 'cancelled', t.price, 0)), 0) AS revenue
     FROM sale_phases p
     LEFT JOIN tickets t ON t.sale_phase_id = p.id
     WHERE p.event_id = ?
     GROUP BY p.id ORDER BY p.phase_order ASC`,
    [event.id]
  );
  const [sellers] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.is_active, a.allocated_quantity,
            COALESCE(SUM(t.status <> 'cancelled'), 0) AS sold,
            COALESCE(SUM(IF(t.status <> 'cancelled', t.price, 0)), 0) AS revenue
     FROM users u
     LEFT JOIN seller_allocations a ON a.seller_id = u.id AND a.event_id = ?
     LEFT JOIN tickets t ON t.seller_id = u.id AND t.event_id = ?
     WHERE u.role = 'seller'
     GROUP BY u.id, a.allocated_quantity
     ORDER BY sold DESC, u.full_name ASC`,
    [event.id, event.id]
  );
  const [recentValidations] = await pool.query(
    `SELECT v.id, v.result, v.message, v.scanned_at,
            t.short_code, t.customer_name, t.selected_color,
            u.full_name AS validator_name
     FROM ticket_validations v
     LEFT JOIN tickets t ON t.id = v.ticket_id
     LEFT JOIN users u ON u.id = v.validator_id
     ORDER BY v.scanned_at DESC, v.id DESC LIMIT 12`
  );

  const sold = Number(totals.sold) || 0;
  res.json({
    event,
    phase,
    metrics: {
      total_tickets: event.total_tickets,
      sold,
      available: Math.max(0, event.total_tickets - sold),
      used: Number(totals.used) || 0,
      cancelled: Number(totals.cancelled) || 0,
      revenue: Number(totals.revenue) || 0,
      by_color: byColor,
      by_phase: byPhase,
    },
    sellers,
    recent_validations: recentValidations,
  });
}));

module.exports = router;
