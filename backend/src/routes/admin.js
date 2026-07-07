const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { ah, uuid, normalizeUsername, isValidEmail } = require('../utils');
const { ecDayStartUtc, ecDayEndUtc, DATE_RE } = require('../time');
const { getActiveEvent, getCurrentPhase } = require('../queries');
const { savePaymentMethodQr, deleteStoredFile, readStoredFile } = require('../storage');
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

  // No reducir el total por debajo de la suma de cupos ya asignados a fases.
  if (id) {
    const [[{ phaseQuota }]] = await pool.query(
      'SELECT COALESCE(SUM(max_tickets), 0) AS phaseQuota FROM sale_phases WHERE event_id = ? AND max_tickets IS NOT NULL',
      [id]
    );
    if (Number(phaseQuota) > total) {
      return res.status(422).json({
        error: `Las fases ya tienen ${phaseQuota} entradas asignadas en cupos: el total del evento no puede ser menor. `
          + 'Reduce primero los cupos por fase.',
      });
    }
  }

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
    id, name, phase_order: phaseOrder, start_date: startDate, end_date: endDate, price,
    max_tickets: maxTickets, is_active: isActive,
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
  // El orden define la secuencia del auto-avance: no puede repetirse.
  const [dupOrder] = await pool.query(
    'SELECT name FROM sale_phases WHERE event_id = ? AND phase_order = ? AND id <> ? LIMIT 1',
    [event.id, orderNum, id || '']
  );
  if (dupOrder.length) {
    return res.status(422).json({
      error: `La fase "${dupOrder[0].name}" ya usa el orden ${orderNum}. Cada fase debe tener un orden único.`,
    });
  }
  const priceNum = Number(price);
  if (price === '' || price == null || Number.isNaN(priceNum) || priceNum < 0) {
    return res.status(422).json({ error: 'El precio de la fase es obligatorio (número mayor o igual a 0)' });
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

  // Cupo de la fase: vacío = sin cupo propio (solo límite del evento).
  let maxNum = null;
  if (maxTickets !== '' && maxTickets != null) {
    maxNum = Number(maxTickets);
    if (!Number.isInteger(maxNum) || maxNum < 1) {
      return res.status(422).json({ error: 'El cupo de la fase debe ser un entero mayor a 0 (o vacío para no limitar)' });
    }
  }

  const [others] = await pool.query(
    'SELECT id, name, starts_at, ends_at, max_tickets, is_active FROM sale_phases WHERE event_id = ? AND id <> ?',
    [event.id, id || '']
  );

  // La suma de cupos por fase no puede superar el total del evento.
  if (maxNum != null) {
    const sumOthers = others.reduce((acc, p) => acc + (p.max_tickets != null ? Number(p.max_tickets) : 0), 0);
    if (sumOthers + maxNum > event.total_tickets) {
      return res.status(422).json({
        error: `La suma de cupos por fase (${sumOthers + maxNum}) supera el total de entradas del evento (${event.total_tickets}). `
          + 'Reduce este cupo o amplía el total del evento.',
      });
    }
  }

  // Sin solapamiento entre fases ACTIVAS: la fase vigente se detecta por
  // fecha y dos fases activas simultáneas darían precio/cupo ambiguos.
  if (active) {
    const overlap = others.find((p) => p.is_active
      && new Date(p.starts_at) <= new Date(endsAt)
      && new Date(p.ends_at) >= new Date(startsAt));
    if (overlap) {
      return res.status(422).json({
        error: `Las fechas se cruzan con la fase activa "${overlap.name}". Ajusta las fechas o desactiva una de las dos.`,
      });
    }
  }

  // No reducir el cupo por debajo de lo ya vendido en la fase.
  if (id && maxNum != null) {
    const [[{ phaseSold }]] = await pool.query(
      "SELECT COUNT(*) AS phaseSold FROM tickets WHERE sale_phase_id = ? AND status IN ('sold','used')",
      [id]
    );
    if (maxNum < Number(phaseSold)) {
      return res.status(422).json({
        error: `Esta fase ya tiene ${phaseSold} entradas vendidas: el cupo no puede ser menor a esa cantidad.`,
      });
    }
  }

  if (id) {
    const [result] = await pool.query(
      `UPDATE sale_phases SET name = ?, phase_order = ?, starts_at = ?, ends_at = ?, price = ?, max_tickets = ?, is_active = ?
       WHERE id = ? AND event_id = ?`,
      [String(name).trim(), orderNum, startsAt, endsAt, priceNum, maxNum, active, id, event.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Fase no encontrada' });
    await audit(pool, { actorId: req.user.id, action: 'phase.update', entityType: 'sale_phase', entityId: id, metadata: { name, price: priceNum, max_tickets: maxNum } });
    return res.json({ ok: true, id, message: 'Fase actualizada' });
  }

  const phaseId = uuid();
  await pool.query(
    `INSERT INTO sale_phases (id, event_id, name, phase_order, starts_at, ends_at, price, max_tickets, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [phaseId, event.id, String(name).trim(), orderNum, startsAt, endsAt, priceNum, maxNum, active]
  );
  await audit(pool, { actorId: req.user.id, action: 'phase.create', entityType: 'sale_phase', entityId: phaseId, metadata: { name, price: priceNum, max_tickets: maxNum } });
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
    `SELECT p.id, p.name, p.price, p.max_tickets, p.is_active, p.phase_order, p.starts_at, p.ends_at,
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

// ------------------------------------------------------------
// Venta web: MÉTODOS DE PAGO (varios bancos, cada uno con su QR)
// + configuración general (switch de venta pública y mensaje).
// Los campos bancarios de payment_settings quedaron legacy: los
// bancos viven en payment_methods.
// ------------------------------------------------------------
const QR_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const qrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

function uploadQrImage(req, res, next) {
  qrUpload.single('qr_image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(422).json({ error: 'La imagen QR de pago supera el tamaño máximo de 2 MB.' });
      }
      return res.status(422).json({ error: 'No se pudo procesar la imagen QR de pago.' });
    }
    return next();
  });
}

// Detecta el MIME real por firma binaria (un ejecutable renombrado no pasa)
function sniffImageMime(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

router.get('/payment-methods', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.json({ methods: [], event_id: null });
  const [rows] = await pool.query(
    `SELECT m.id, m.bank_name, m.account_type, m.account_number, m.account_holder,
            m.account_document, m.transfer_note, m.is_active, m.sort_order,
            (m.qr_image_path IS NOT NULL) AS has_qr_image,
            (SELECT COUNT(*) FROM purchase_requests r WHERE r.payment_method_id = m.id) AS requests_count
     FROM payment_methods m WHERE m.event_id = ?
     ORDER BY m.sort_order ASC, m.created_at ASC`,
    [event.id]
  );
  res.json({
    event_id: event.id,
    methods: rows.map((m) => ({ ...m, is_active: Boolean(m.is_active), has_qr_image: Boolean(m.has_qr_image) })),
  });
}));

// Crear o editar método (multipart: campos + qr_image opcional)
router.post('/payment-methods', uploadQrImage, ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.status(409).json({ error: 'No hay evento activo configurado.' });

  const body = req.body || {};
  const clean = (v, max) => {
    const s = String(v == null ? '' : v).trim().slice(0, max);
    return s || null;
  };
  const id = clean(body.id, 36);
  const values = {
    bank_name: clean(body.bank_name, 120),
    account_type: clean(body.account_type, 60),
    account_number: clean(body.account_number, 60),
    account_holder: clean(body.account_holder, 120),
    account_document: clean(body.account_document, 30),
    transfer_note: clean(body.transfer_note, 300),
  };
  if (!values.bank_name || !values.account_number || !values.account_holder) {
    return res.status(422).json({ error: 'Banco, número de cuenta y titular son obligatorios.' });
  }
  const isActive = ['1', 'true', 'on'].includes(String(body.is_active)) ? 1 : 0;
  let sortOrder = Number(body.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 1) sortOrder = null; // se calcula abajo

  // QR propio del método (opcional)
  let qrBuffer = null;
  let qrMime = null;
  if (req.file && req.file.buffer && req.file.buffer.length) {
    qrMime = sniffImageMime(req.file.buffer);
    if (!qrMime || !QR_IMAGE_TYPES[qrMime]) {
      return res.status(422).json({ error: 'La imagen QR de pago debe ser JPG, PNG o WEBP.' });
    }
    qrBuffer = req.file.buffer;
  }
  const removeQr = ['1', 'true', 'on'].includes(String(body.remove_qr_image));

  if (id) {
    const [rows] = await pool.query(
      'SELECT id, qr_image_path FROM payment_methods WHERE id = ? AND event_id = ?',
      [id, event.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Método de pago no encontrado' });

    const sets = ['bank_name = ?', 'account_type = ?', 'account_number = ?', 'account_holder = ?',
      'account_document = ?', 'transfer_note = ?', 'is_active = ?'];
    const params = [values.bank_name, values.account_type, values.account_number, values.account_holder,
      values.account_document, values.transfer_note, isActive];
    if (sortOrder != null) { sets.push('sort_order = ?'); params.push(sortOrder); }
    if (qrBuffer) {
      const file = await savePaymentMethodQr(event.id, id, QR_IMAGE_TYPES[qrMime], qrBuffer);
      sets.push('qr_image_path = ?', 'qr_image_mime = ?');
      params.push(file, qrMime);
    } else if (removeQr && rows[0].qr_image_path) {
      await deleteStoredFile(rows[0].qr_image_path);
      sets.push('qr_image_path = NULL', 'qr_image_mime = NULL');
    }
    params.push(id);
    await pool.query(`UPDATE payment_methods SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit(pool, { actorId: req.user.id, action: 'payment_method.update', entityType: 'payment_method', entityId: id, metadata: { bank_name: values.bank_name, is_active: Boolean(isActive) } });
    return res.json({ ok: true, id, message: `Método "${values.bank_name}" actualizado` });
  }

  const methodId = uuid();
  if (sortOrder == null) {
    const [[{ maxOrder }]] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM payment_methods WHERE event_id = ?',
      [event.id]
    );
    sortOrder = Number(maxOrder) + 1;
  }
  let qrPath = null;
  if (qrBuffer) qrPath = await savePaymentMethodQr(event.id, methodId, QR_IMAGE_TYPES[qrMime], qrBuffer);
  await pool.query(
    `INSERT INTO payment_methods
       (id, event_id, bank_name, account_type, account_number, account_holder, account_document,
        transfer_note, qr_image_path, qr_image_mime, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [methodId, event.id, values.bank_name, values.account_type, values.account_number, values.account_holder,
      values.account_document, values.transfer_note, qrPath, qrBuffer ? qrMime : null, isActive, sortOrder]
  );
  await audit(pool, { actorId: req.user.id, action: 'payment_method.create', entityType: 'payment_method', entityId: methodId, metadata: { bank_name: values.bank_name } });
  return res.status(201).json({ ok: true, id: methodId, message: `Método "${values.bank_name}" creado` });
}));

router.post('/payment-methods/:id/toggle', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.status(409).json({ error: 'No hay evento activo configurado.' });
  const [rows] = await pool.query(
    'SELECT id, bank_name, is_active FROM payment_methods WHERE id = ? AND event_id = ?',
    [String(req.params.id), event.id]
  );
  const method = rows[0];
  if (!method) return res.status(404).json({ error: 'Método de pago no encontrado' });
  const newState = method.is_active ? 0 : 1;
  await pool.query('UPDATE payment_methods SET is_active = ? WHERE id = ?', [newState, method.id]);
  await audit(pool, { actorId: req.user.id, action: newState ? 'payment_method.activate' : 'payment_method.deactivate', entityType: 'payment_method', entityId: method.id, metadata: { bank_name: method.bank_name } });
  res.json({
    ok: true,
    is_active: Boolean(newState),
    message: `Método "${method.bank_name}" ${newState ? 'activado' : 'desactivado'}`,
  });
}));

// Eliminar un método SOLO si ninguna solicitud lo referencia (si ya
// tiene movimientos, se desactiva para conservar la contabilidad).
router.delete('/payment-methods/:id', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.status(409).json({ error: 'No hay evento activo configurado.' });
  const [rows] = await pool.query(
    'SELECT id, bank_name, qr_image_path FROM payment_methods WHERE id = ? AND event_id = ?',
    [String(req.params.id), event.id]
  );
  const method = rows[0];
  if (!method) return res.status(404).json({ error: 'Método de pago no encontrado' });
  const [[{ used }]] = await pool.query(
    'SELECT COUNT(*) AS used FROM purchase_requests WHERE payment_method_id = ?',
    [method.id]
  );
  if (Number(used) > 0) {
    return res.status(409).json({
      error: `"${method.bank_name}" ya tiene ${used} solicitud(es) asociadas: desactívalo en lugar de eliminarlo para conservar la contabilidad.`,
    });
  }
  if (method.qr_image_path) await deleteStoredFile(method.qr_image_path);
  await pool.query('DELETE FROM payment_methods WHERE id = ?', [method.id]);
  await audit(pool, { actorId: req.user.id, action: 'payment_method.delete', entityType: 'payment_method', entityId: method.id, metadata: { bank_name: method.bank_name } });
  res.json({ ok: true, message: `Método "${method.bank_name}" eliminado` });
}));

// Imagen QR de un método para el panel (incluye métodos inactivos)
router.get('/payment-methods/:id/qr', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.status(404).json({ error: 'No disponible' });
  const [rows] = await pool.query(
    'SELECT qr_image_path, qr_image_mime FROM payment_methods WHERE id = ? AND event_id = ?',
    [String(req.params.id), event.id]
  );
  const method = rows[0];
  if (!method || !method.qr_image_path) return res.status(404).json({ error: 'No disponible' });
  const buffer = await readStoredFile(method.qr_image_path);
  if (!buffer) return res.status(404).json({ error: 'No disponible' });
  res.setHeader('Content-Type', method.qr_image_mime || 'image/png');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}));

// ------------------------------------------------------------
// Configuración general de la venta web: switch + mensaje.
// ------------------------------------------------------------
router.get('/payment-settings', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.json({ settings: null, event_id: null });
  const [rows] = await pool.query('SELECT * FROM payment_settings WHERE event_id = ?', [event.id]);
  const s = rows[0] || null;
  const [[{ activeMethods }]] = await pool.query(
    'SELECT COUNT(*) AS activeMethods FROM payment_methods WHERE event_id = ? AND is_active = 1',
    [event.id]
  );
  res.json({
    event_id: event.id,
    active_methods: Number(activeMethods) || 0,
    settings: s ? {
      buyer_message: s.buyer_message,
      public_sales_enabled: Boolean(s.public_sales_enabled),
    } : null,
  });
}));

router.post('/payment-settings', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.status(409).json({ error: 'No hay evento activo configurado.' });

  const body = req.body || {};
  const buyerMessage = String(body.buyer_message == null ? '' : body.buyer_message).trim().slice(0, 500) || null;
  const salesEnabled = body.public_sales_enabled === true || ['1', 'true', 'on'].includes(String(body.public_sales_enabled)) ? 1 : 0;

  // Para habilitar la venta pública debe existir al menos un método
  // de pago activo (si no, el comprador no sabría a dónde pagar).
  if (salesEnabled) {
    const [[{ activeMethods }]] = await pool.query(
      'SELECT COUNT(*) AS activeMethods FROM payment_methods WHERE event_id = ? AND is_active = 1',
      [event.id]
    );
    if (!Number(activeMethods)) {
      return res.status(422).json({
        error: 'Para activar la venta web agrega y activa al menos un banco/método de pago.',
      });
    }
  }

  const [existing] = await pool.query('SELECT id FROM payment_settings WHERE event_id = ?', [event.id]);
  if (existing.length) {
    await pool.query(
      'UPDATE payment_settings SET buyer_message = ?, public_sales_enabled = ? WHERE id = ?',
      [buyerMessage, salesEnabled, existing[0].id]
    );
  } else {
    await pool.query(
      'INSERT INTO payment_settings (id, event_id, buyer_message, public_sales_enabled) VALUES (?, ?, ?, ?)',
      [uuid(), event.id, buyerMessage, salesEnabled]
    );
  }

  await audit(pool, {
    actorId: req.user.id,
    action: 'payment_settings.update',
    entityType: 'payment_settings',
    entityId: event.id,
    metadata: { public_sales_enabled: Boolean(salesEnabled) },
  });
  res.json({
    ok: true,
    message: salesEnabled
      ? 'Configuración guardada. La venta web está ACTIVA.'
      : 'Configuración guardada. La venta web está desactivada.',
  });
}));

module.exports = router;
