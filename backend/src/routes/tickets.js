const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { ah, uuid, qrHash, newQrToken, isValidEmail, COLORS } = require('../utils');
const { getCurrentPhase } = require('../queries');
const { generateTicketPdf } = require('../pdf');
const { sendTicketEmail } = require('../mailer');
const { ticketPdfPath, saveTicketPdf, readTicketPdf } = require('../storage');
const { audit } = require('../audit');

const router = express.Router();
router.use(requireAuth);

// Columnas seguras para listados (NUNCA exponer qr_token ni qr_hash).
const LIST_SELECT = `
  SELECT t.id, t.short_code, t.ticket_number, t.customer_name, t.customer_email,
         t.selected_color, t.price, t.status, t.notes, t.email_sent_at, t.email_last_error,
         t.sold_at, t.used_at, t.cancelled_at, t.cancellation_reason, t.seller_id, t.sale_phase_id,
         p.name AS phase_name, u.full_name AS seller_name, v.full_name AS validated_by_name
  FROM tickets t
  JOIN users u ON u.id = t.seller_id
  LEFT JOIN sale_phases p ON p.id = t.sale_phase_id
  LEFT JOIN users v ON v.id = t.validated_by
`;

// Fila completa (interna: incluye qr_token para PDF/QR).
async function loadTicketFull(id, db = pool) {
  const [rows] = await db.query(
    `SELECT t.*, p.name AS phase_name, u.full_name AS seller_name,
            e.name AS event_name, e.event_date, e.location AS event_location,
            v.full_name AS validated_by_name
     FROM tickets t
     JOIN events e ON e.id = t.event_id
     JOIN users u ON u.id = t.seller_id
     LEFT JOIN sale_phases p ON p.id = t.sale_phase_id
     LEFT JOIN users v ON v.id = t.validated_by
     WHERE t.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Genera el PDF y lo guarda en STORAGE_DIR/tickets/{event_id}/{ticket_id}.pdf
async function buildAndStorePdf(ticket) {
  const buffer = await generateTicketPdf(ticket);
  const file = await saveTicketPdf(ticket.event_id, ticket.id, buffer);
  await pool.query('UPDATE tickets SET pdf_path = ? WHERE id = ?', [file, ticket.id]);
  return { buffer, file };
}

// Datos del ticket que ve el personal (venta y puerta), sin token ni hash.
function publicTicket(t) {
  return {
    id: t.id,
    short_code: t.short_code,
    ticket_number: t.ticket_number,
    customer_name: t.customer_name,
    customer_email: t.customer_email,
    selected_color: t.selected_color,
    price: t.price,
    status: t.status,
    notes: t.notes || null,
    sold_at: t.sold_at,
    used_at: t.used_at || null,
    phase_name: t.phase_name || null,
    seller_name: t.seller_name || null,
    validated_by_name: t.validated_by_name || null,
    event: t.event_name
      ? { name: t.event_name, event_date: t.event_date, location: t.event_location }
      : undefined,
  };
}

// ------------------------------------------------------------
// Venta (roles: seller, admin). El precio, la fase y el vendedor
// los determina SIEMPRE el servidor.
// ------------------------------------------------------------
router.post('/', requireRole('seller', 'admin'), ah(async (req, res) => {
  const { customer_name: rawName, customer_email: rawEmail, selected_color: color, notes } = req.body || {};

  const customerName = String(rawName || '').trim();
  if (customerName.length < 3 || customerName.length > 120) {
    return res.status(422).json({ error: 'El nombre del cliente debe tener entre 3 y 120 caracteres' });
  }
  if (!isValidEmail(rawEmail)) {
    return res.status(422).json({ error: 'El correo del cliente no es válido' });
  }
  const customerEmail = String(rawEmail).trim().toLowerCase();
  if (!COLORS.includes(color)) {
    return res.status(422).json({ error: 'Color inválido: debe ser verde, rojo o amarillo' });
  }
  const notesClean = notes ? String(notes).trim().slice(0, 500) : null;

  const conn = await pool.getConnection();
  let ticketId;
  try {
    await conn.beginTransaction();

    // El lock del evento serializa todas las ventas del mismo evento:
    // evita sobreventa del límite global y del cupo bajo concurrencia.
    const [eventRows] = await conn.query(
      'SELECT id, name, total_tickets FROM events WHERE is_active = 1 ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE'
    );
    const event = eventRows[0];
    if (!event) {
      await conn.rollback();
      return res.status(409).json({ error: 'No hay evento activo configurado.' });
    }

    const phase = await getCurrentPhase(event.id, conn);
    if (!phase) {
      await conn.rollback();
      return res.status(409).json({ error: 'No hay una fase de venta activa para la fecha actual.' });
    }

    // Límite global del evento
    const [[{ soldTotal }]] = await conn.query(
      "SELECT COUNT(*) AS soldTotal FROM tickets WHERE event_id = ? AND status IN ('sold','used')",
      [event.id]
    );
    if (soldTotal >= event.total_tickets) {
      await conn.rollback();
      return res.status(409).json({ error: 'Ya se vendieron todas las entradas disponibles.' });
    }

    // Cupo del vendedor: un seller sin asignación no puede vender;
    // un admin sin asignación vende sin tope propio (solo límite global).
    if (req.user.role === 'seller') {
      const [allocRows] = await conn.query(
        'SELECT allocated_quantity FROM seller_allocations WHERE event_id = ? AND seller_id = ? FOR UPDATE',
        [event.id, req.user.id]
      );
      const allocated = allocRows.length ? allocRows[0].allocated_quantity : 0;
      const [[{ mySold }]] = await conn.query(
        "SELECT COUNT(*) AS mySold FROM tickets WHERE event_id = ? AND seller_id = ? AND status <> 'cancelled'",
        [event.id, req.user.id]
      );
      if (!allocRows.length || mySold >= allocated) {
        await conn.rollback();
        return res.status(409).json({ error: 'No tienes entradas disponibles.' });
      }
    }

    // Correlativo por evento y código corto global
    const [[{ maxNum }]] = await conn.query(
      'SELECT COALESCE(MAX(ticket_number), 0) AS maxNum FROM tickets WHERE event_id = ?',
      [event.id]
    );
    await conn.query('UPDATE short_code_counter SET `last_value` = `last_value` + 1 WHERE id = 1');
    const [[{ lastValue }]] = await conn.query('SELECT `last_value` AS lastValue FROM short_code_counter WHERE id = 1');
    const shortCode = `FF-${String(lastValue).padStart(4, '0')}`;

    // Credenciales del QR: el QR solo contiene la URL con el token,
    // nunca datos personales. La BD guarda token y hash con QR_SECRET.
    const qrToken = newQrToken();
    ticketId = uuid();
    await conn.query(
      `INSERT INTO tickets (id, event_id, seller_id, sale_phase_id, ticket_number, short_code,
                            qr_token, qr_hash, customer_name, customer_email, selected_color,
                            price, status, notes, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sold', ?, UTC_TIMESTAMP())`,
      [ticketId, event.id, req.user.id, phase.id, Number(maxNum) + 1, shortCode,
        qrToken, qrHash(qrToken), customerName, customerEmail, color, phase.price, notesClean]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // PDF y correo FUERA de la transacción: si fallan, la venta no se
  // revierte; el PDF se regenera bajo demanda y el correo se reenvía.
  const ticket = await loadTicketFull(ticketId);
  let emailSent = false;
  let failure = null;
  let pdfBuffer = null;
  try {
    ({ buffer: pdfBuffer } = await buildAndStorePdf(ticket));
  } catch (err) {
    console.error('Error generando PDF:', err);
    failure = `PDF: ${err.message}`;
  }
  if (pdfBuffer) {
    const result = await sendTicketEmail(ticket, pdfBuffer);
    if (result.ok) {
      emailSent = true;
      await pool.query('UPDATE tickets SET email_sent_at = UTC_TIMESTAMP(), email_last_error = NULL WHERE id = ?', [ticketId]);
    } else {
      failure = result.error;
    }
  }
  if (failure) {
    await pool.query('UPDATE tickets SET email_last_error = ? WHERE id = ?', [failure, ticketId]);
  }

  await audit(pool, {
    actorId: req.user.id,
    action: 'ticket.create',
    entityType: 'ticket',
    entityId: ticketId,
    metadata: { short_code: ticket.short_code, price: ticket.price, color, email_sent: emailSent },
  });

  res.status(201).json({
    ok: true,
    ticket: publicTicket(ticket),
    emailSent,
    downloadUrl: `/api/tickets/${ticketId}/pdf`,
    message: emailSent
      ? 'Entrada creada y enviada correctamente.'
      : 'Entrada creada, pero no se pudo enviar el correo. Puedes reenviarla desde la tabla.',
  });
}));

// ------------------------------------------------------------
// Listado (admin: todas; seller: solo las suyas)
// ------------------------------------------------------------
router.get('/', requireRole('seller', 'admin'), ah(async (req, res) => {
  const where = [];
  const params = [];
  if (req.user.role !== 'admin') {
    where.push('t.seller_id = ?');
    params.push(req.user.id);
  } else if (req.query.seller_id) {
    where.push('t.seller_id = ?');
    params.push(String(req.query.seller_id));
  }
  if (req.query.status && ['sold', 'used', 'cancelled'].includes(req.query.status)) {
    where.push('t.status = ?');
    params.push(req.query.status);
  }
  if (req.query.color && COLORS.includes(req.query.color)) {
    where.push('t.selected_color = ?');
    params.push(req.query.color);
  }
  if (req.query.phase_id) {
    where.push('t.sale_phase_id = ?');
    params.push(String(req.query.phase_id));
  }
  if (req.query.q) {
    where.push('(t.short_code LIKE ? OR t.customer_name LIKE ? OR t.customer_email LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `${LIST_SELECT} ${whereSql} ORDER BY t.ticket_number DESC LIMIT 1000`,
    params
  );
  res.json({ tickets: rows });
}));

// ------------------------------------------------------------
// Validación en puerta (roles: validator, admin)
// ------------------------------------------------------------

// Acepta URL completa, ruta /ticket/validate/xxx o token suelto.
// Tokens de 64 hex (nuevos) o 48 hex (entradas migradas de la app anterior).
function parseScannedToken(value) {
  let s = String(value || '').trim();
  try {
    s = new URL(s).pathname;
  } catch { /* no era una URL */ }
  const m = s.match(/\/ticket\/validate\/([a-f0-9]{40,64})\/?$/i) || s.match(/^([a-f0-9]{40,64})$/i);
  return m ? m[1].toLowerCase() : null;
}

// Normaliza "ff-0001" / "FF0001" / "1" -> "FF-0001"
function normalizeShortCode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits || digits.length > 8) return null;
  const n = Number(digits);
  if (!Number.isInteger(n) || n < 1) return null;
  return `FF-${String(n).padStart(4, '0')}`;
}

const VALIDATION_MESSAGES = {
  valid: 'Entrada válida. Ingreso autorizado.',
  already_used: 'Esta entrada ya fue utilizada.',
  cancelled: 'Esta entrada fue anulada.',
  invalid: 'QR inválido o no registrado.',
};

// Transacción de validación: FOR UPDATE serializa dos escaneos
// simultáneos del mismo ticket. SIEMPRE registra el intento.
async function runValidation({ column, value, validatorId, source }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT t.*, p.name AS phase_name, u.full_name AS seller_name,
              e.name AS event_name, e.event_date, e.location AS event_location
       FROM tickets t
       JOIN events e ON e.id = t.event_id
       JOIN users u ON u.id = t.seller_id
       LEFT JOIN sale_phases p ON p.id = t.sale_phase_id
       WHERE t.${column} = ?
       FOR UPDATE`,
      [value]
    );
    const ticket = rows[0] || null;

    let result;
    if (!ticket) result = 'invalid';
    else if (ticket.status === 'cancelled') result = 'cancelled';
    else if (ticket.status === 'used') result = 'already_used';
    else result = 'valid';

    if (result === 'valid') {
      await conn.query(
        "UPDATE tickets SET status = 'used', used_at = UTC_TIMESTAMP(), validated_by = ? WHERE id = ?",
        [validatorId, ticket.id]
      );
      ticket.status = 'used';
      ticket.used_at = new Date();
    }

    await conn.query(
      `INSERT INTO ticket_validations (id, ticket_id, validator_id, result, message, metadata, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [uuid(), ticket ? ticket.id : null, validatorId, result, VALIDATION_MESSAGES[result],
        JSON.stringify({ source })]
    );
    await conn.commit();

    if (ticket && result === 'valid') {
      const [vrows] = await pool.query('SELECT full_name FROM users WHERE id = ?', [validatorId]);
      ticket.validated_by_name = vrows.length ? vrows[0].full_name : null;
    }
    return { result, ticket };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Registra un intento con QR ilegible/desconocido (sin ticket asociado).
async function logInvalidAttempt(validatorId, source, raw) {
  await pool.query(
    `INSERT INTO ticket_validations (id, ticket_id, validator_id, result, message, metadata, scanned_at)
     VALUES (?, NULL, ?, 'invalid', ?, ?, UTC_TIMESTAMP())`,
    [uuid(), validatorId, VALIDATION_MESSAGES.invalid,
      JSON.stringify({ source, scanned: String(raw || '').slice(0, 120) })]
  );
}

router.post('/validate', requireRole('validator', 'admin'), ah(async (req, res) => {
  const { scannedValue, source } = req.body || {};
  const src = ['scanner', 'manual', 'link'].includes(source) ? source : 'scanner';

  const token = parseScannedToken(scannedValue);
  if (!token) {
    await logInvalidAttempt(req.user.id, src, scannedValue);
    return res.json({ status: 'invalid', message: VALIDATION_MESSAGES.invalid });
  }

  const { result, ticket } = await runValidation({
    column: 'qr_hash',
    value: qrHash(token),
    validatorId: req.user.id,
    source: src,
  });
  res.json({
    status: result,
    message: VALIDATION_MESSAGES[result],
    ticket: ticket ? publicTicket(ticket) : undefined,
  });
}));

router.post('/validate-code', requireRole('validator', 'admin'), ah(async (req, res) => {
  const { code } = req.body || {};
  const shortCode = normalizeShortCode(code);
  if (!shortCode) {
    await logInvalidAttempt(req.user.id, 'manual', code);
    return res.json({ status: 'invalid', message: 'Código inválido. Usa el formato FF-0001.' });
  }

  const { result, ticket } = await runValidation({
    column: 'short_code',
    value: shortCode,
    validatorId: req.user.id,
    source: 'manual',
  });
  res.json({
    status: result,
    message: result === 'invalid' ? `No existe ninguna entrada con el código ${shortCode}.` : VALIDATION_MESSAGES[result],
    ticket: ticket ? publicTicket(ticket) : undefined,
  });
}));

// Historial de validaciones (para el scanner y el panel)
router.get('/validations', requireRole('validator', 'admin'), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT v.id, v.result, v.message, v.scanned_at, v.metadata,
            t.short_code, t.customer_name, t.selected_color,
            u.full_name AS validator_name
     FROM ticket_validations v
     LEFT JOIN tickets t ON t.id = v.ticket_id
     LEFT JOIN users u ON u.id = v.validator_id
     ORDER BY v.scanned_at DESC, v.id DESC
     LIMIT 200`
  );
  res.json({ validations: rows });
}));

// ------------------------------------------------------------
// PDF, reenvío y anulación
// ------------------------------------------------------------
async function findTicketForUser(req, res) {
  const ticket = await loadTicketFull(String(req.params.id));
  if (!ticket) {
    res.status(404).json({ error: 'Entrada no encontrada' });
    return null;
  }
  if (req.user.role !== 'admin' && ticket.seller_id !== req.user.id) {
    res.status(403).json({ error: 'No tienes acceso a esta entrada' });
    return null;
  }
  return ticket;
}

router.get('/:id/pdf', requireRole('seller', 'admin'), ah(async (req, res) => {
  const ticket = await findTicketForUser(req, res);
  if (!ticket) return;

  // Servir desde disco; si no existe, regenerar desde la BD y guardar.
  let buffer = ticket.pdf_path ? await readTicketPdf(ticket.pdf_path) : null;
  if (!buffer) {
    buffer = await readTicketPdf(ticketPdfPath(ticket.event_id, ticket.id));
  }
  if (!buffer) {
    ({ buffer } = await buildAndStorePdf(ticket));
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="entrada-${ticket.short_code}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}));

router.post('/:id/resend', requireRole('seller', 'admin'), ah(async (req, res) => {
  const ticket = await findTicketForUser(req, res);
  if (!ticket) return;
  if (ticket.status === 'cancelled') {
    return res.status(409).json({ error: 'No se puede reenviar una entrada anulada' });
  }

  let buffer = ticket.pdf_path ? await readTicketPdf(ticket.pdf_path) : null;
  if (!buffer) {
    ({ buffer } = await buildAndStorePdf(ticket));
  }
  const result = await sendTicketEmail(ticket, buffer);
  if (!result.ok) {
    await pool.query('UPDATE tickets SET email_last_error = ? WHERE id = ?', [result.error, ticket.id]);
    return res.status(502).json({ error: `No se pudo enviar el correo: ${result.error}` });
  }
  await pool.query('UPDATE tickets SET email_sent_at = UTC_TIMESTAMP(), email_last_error = NULL WHERE id = ?', [ticket.id]);
  await audit(pool, {
    actorId: req.user.id,
    action: 'ticket.resend_email',
    entityType: 'ticket',
    entityId: ticket.id,
    metadata: { short_code: ticket.short_code, to: ticket.customer_email },
  });
  res.json({ ok: true, message: `Entrada ${ticket.short_code} reenviada a ${ticket.customer_email}` });
}));

router.post('/:id/cancel', requireRole('admin'), ah(async (req, res) => {
  const reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 300) : null;
  const ticket = await loadTicketFull(String(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Entrada no encontrada' });
  if (ticket.status === 'cancelled') {
    return res.status(409).json({ error: 'La entrada ya está anulada' });
  }
  if (ticket.status === 'used') {
    return res.status(409).json({ error: 'No se puede anular una entrada ya utilizada' });
  }
  await pool.query(
    `UPDATE tickets SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), cancelled_by = ?, cancellation_reason = ?
     WHERE id = ?`,
    [req.user.id, reason, ticket.id]
  );
  await audit(pool, {
    actorId: req.user.id,
    action: 'ticket.cancel',
    entityType: 'ticket',
    entityId: ticket.id,
    metadata: { short_code: ticket.short_code, reason },
  });
  res.json({ ok: true, message: `Entrada ${ticket.short_code} anulada. Su cupo queda liberado.` });
}));

// Detalle (después de las rutas específicas)
router.get('/:id', requireRole('seller', 'admin'), ah(async (req, res) => {
  const ticket = await findTicketForUser(req, res);
  if (!ticket) return;
  res.json({ ticket: publicTicket(ticket) });
}));

module.exports = router;
