// Módulo interno "Compras web": revisión y validación manual de los
// pagos por transferencia enviados desde la página pública /comprar.
//
// Acceso: admin y seller (organizadores). Solo al APROBAR se crea la
// entrada real en `tickets` (misma lógica de QR/PDF/correo que una
// venta manual, 100% compatible con el escáner actual).
const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { ah, uuid, qrHash, newQrToken, COLORS } = require('../utils');
const { generateTicketPdf } = require('../pdf');
const { sendTicketEmail } = require('../mailer');
const { sendRequestRejectedEmail } = require('../webMailer');
const { saveTicketPdf, readStoredFile } = require('../storage');
const { audit } = require('../audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'seller'));

const STATUSES = ['pending', 'approved', 'rejected'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Columnas seguras para listados/detalle (nunca exponer el hash ni la
// ruta del comprobante en disco: el archivo se sirve por /:id/proof).
const LIST_SELECT = `
  SELECT r.id, r.request_code, r.buyer_name, r.buyer_email, r.buyer_phone, r.buyer_document,
         r.selected_color, r.sale_phase_id, r.phase_name, r.price, r.status, r.notes,
         r.rejection_reason, r.approved_at, r.rejected_at, r.ticket_id,
         r.payment_proof_filename, r.payment_proof_mime,
         r.status_email_sent_at, r.created_at,
         ua.full_name AS approved_by_name, ur.full_name AS rejected_by_name,
         t.short_code AS ticket_short_code, t.status AS ticket_status
  FROM purchase_requests r
  LEFT JOIN users ua ON ua.id = r.approved_by
  LEFT JOIN users ur ON ur.id = r.rejected_by
  LEFT JOIN tickets t ON t.id = r.ticket_id
`;

async function loadRequest(id, db = pool) {
  const [rows] = await db.query(`${LIST_SELECT} WHERE r.id = ?`, [String(id)]);
  return rows[0] || null;
}

// ------------------------------------------------------------
// GET /api/purchases — listado con filtros + resumen
// ------------------------------------------------------------
router.get('/', ah(async (req, res) => {
  const [events] = await pool.query(
    'SELECT id, name, total_tickets FROM events WHERE is_active = 1 ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  const event = events[0] || null;
  if (!event) return res.json({ requests: [], summary: null, event: null });

  const where = ['r.event_id = ?'];
  const params = [event.id];
  if (req.query.status && STATUSES.includes(req.query.status)) {
    where.push('r.status = ?');
    params.push(req.query.status);
  }
  if (req.query.color && COLORS.includes(req.query.color)) {
    where.push('r.selected_color = ?');
    params.push(req.query.color);
  }
  if (req.query.phase_id) {
    where.push('r.sale_phase_id = ?');
    params.push(String(req.query.phase_id));
  }
  if (req.query.date_from && DATE_RE.test(String(req.query.date_from))) {
    where.push('r.created_at >= ?');
    params.push(`${req.query.date_from} 00:00:00`);
  }
  if (req.query.date_to && DATE_RE.test(String(req.query.date_to))) {
    where.push('r.created_at <= ?');
    params.push(`${req.query.date_to} 23:59:59`);
  }
  if (req.query.q) {
    where.push('(r.request_code LIKE ? OR r.buyer_name LIKE ? OR r.buyer_email LIKE ? OR r.buyer_phone LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like, like);
  }

  const [rows] = await pool.query(
    `${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.request_code DESC LIMIT 1000`,
    params
  );

  const [[counts]] = await pool.query(
    `SELECT SUM(status = 'pending')  AS pending,
            SUM(status = 'approved') AS approved,
            SUM(status = 'rejected') AS rejected,
            COALESCE(SUM(IF(status = 'approved', price, 0)), 0) AS approved_revenue
     FROM purchase_requests WHERE event_id = ?`,
    [event.id]
  );
  const [[{ sold }]] = await pool.query(
    "SELECT COUNT(*) AS sold FROM tickets WHERE event_id = ? AND status IN ('sold','used')",
    [event.id]
  );

  res.json({
    requests: rows,
    event: { id: event.id, name: event.name, total_tickets: event.total_tickets },
    summary: {
      pending: Number(counts.pending) || 0,
      approved: Number(counts.approved) || 0,
      rejected: Number(counts.rejected) || 0,
      approved_revenue: Number(counts.approved_revenue) || 0,
      tickets_available: Math.max(0, event.total_tickets - (Number(sold) || 0)),
    },
  });
}));

// ------------------------------------------------------------
// GET /api/purchases/:id/proof — comprobante de pago (inline)
// ------------------------------------------------------------
router.get('/:id/proof', ah(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT payment_proof_path, payment_proof_mime, request_code FROM purchase_requests WHERE id = ?',
    [String(req.params.id)]
  );
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const buffer = await readStoredFile(request.payment_proof_path);
  if (!buffer) return res.status(404).json({ error: 'El comprobante ya no está disponible en el servidor' });
  res.setHeader('Content-Type', request.payment_proof_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="comprobante-${request.request_code}.${request.payment_proof_mime === 'application/pdf' ? 'pdf' : 'img'}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}));

// ------------------------------------------------------------
// POST /api/purchases/:id/approve — APROBAR pago pendiente.
// Transacción atómica: revalida estado + disponibilidad con locks,
// crea la entrada real y marca la solicitud, todo o nada. El PDF y
// el correo van después (si fallan, se reenvía desde Entradas).
// ------------------------------------------------------------
router.post('/:id/approve', ah(async (req, res) => {
  const requestIdParam = String(req.params.id);

  const conn = await pool.getConnection();
  let ticketId;
  let approvedRequest;
  try {
    await conn.beginTransaction();

    // 1) Lock de la solicitud: dos aprobaciones simultáneas (doble clic,
    //    dos usuarios, recarga) se serializan aquí.
    const [reqRows] = await conn.query(
      'SELECT * FROM purchase_requests WHERE id = ? FOR UPDATE',
      [requestIdParam]
    );
    const request = reqRows[0];
    if (!request) {
      await conn.rollback();
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    if (request.status !== 'pending' || request.ticket_id) {
      await conn.rollback();
      return res.status(409).json({
        error: request.status === 'approved' || request.ticket_id
          ? 'Esta solicitud ya fue aprobada (la entrada ya existe).'
          : 'Esta solicitud ya fue rechazada. Solo se aprueban solicitudes pendientes.',
      });
    }

    // 2) Lock del evento: serializa contra ventas manuales y otras
    //    aprobaciones (sin sobreventa del límite global).
    const [eventRows] = await conn.query(
      'SELECT id, name, total_tickets, is_active FROM events WHERE id = ? FOR UPDATE',
      [request.event_id]
    );
    const event = eventRows[0];
    if (!event || !event.is_active) {
      await conn.rollback();
      return res.status(409).json({ error: 'El evento de esta solicitud ya no está activo.' });
    }
    const [[{ soldTotal }]] = await conn.query(
      "SELECT COUNT(*) AS soldTotal FROM tickets WHERE event_id = ? AND status IN ('sold','used')",
      [event.id]
    );
    if (soldTotal >= event.total_tickets) {
      await conn.rollback();
      return res.status(409).json({ error: 'Ya no quedan entradas disponibles: no se puede aprobar esta solicitud.' });
    }

    // 2b) Cupo de la fase congelada en la solicitud: solo la aprobación
    //     consume cupo, así que se valida aquí (con lock) y no al solicitar.
    if (request.sale_phase_id) {
      const [phaseRows] = await conn.query(
        'SELECT id, name, max_tickets FROM sale_phases WHERE id = ? FOR UPDATE',
        [request.sale_phase_id]
      );
      const phase = phaseRows[0];
      if (phase && phase.max_tickets != null) {
        const [[{ phaseSold }]] = await conn.query(
          "SELECT COUNT(*) AS phaseSold FROM tickets WHERE sale_phase_id = ? AND status IN ('sold','used')",
          [phase.id]
        );
        if (phaseSold >= phase.max_tickets) {
          await conn.rollback();
          return res.status(409).json({
            error: `No se puede aprobar esta solicitud porque el cupo de la fase "${phase.name}" ya se agotó `
              + `(${phaseSold}/${phase.max_tickets}). Amplía el cupo de la fase o rechaza la solicitud.`,
          });
        }
      }
    }

    // 3) Crear la entrada real (misma lógica que la venta manual:
    //    correlativo por evento, código corto global, QR token + hash).
    const [[{ maxNum }]] = await conn.query(
      'SELECT COALESCE(MAX(ticket_number), 0) AS maxNum FROM tickets WHERE event_id = ?',
      [event.id]
    );
    await conn.query('UPDATE short_code_counter SET `last_value` = `last_value` + 1 WHERE id = 1');
    const [[{ lastValue }]] = await conn.query('SELECT `last_value` AS lastValue FROM short_code_counter WHERE id = 1');
    const shortCode = `FF-${String(lastValue).padStart(4, '0')}`;

    const qrToken = newQrToken();
    ticketId = uuid();
    const ticketNotes = `Compra web ${request.request_code} · Tel: ${request.buyer_phone}`.slice(0, 500);
    await conn.query(
      `INSERT INTO tickets (id, event_id, seller_id, sale_phase_id, ticket_number, short_code,
                            qr_token, qr_hash, customer_name, customer_email, selected_color,
                            price, status, notes, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sold', ?, UTC_TIMESTAMP())`,
      [ticketId, event.id, req.user.id, request.sale_phase_id, Number(maxNum) + 1, shortCode,
        qrToken, qrHash(qrToken), request.buyer_name, request.buyer_email, request.selected_color,
        request.price, ticketNotes]
    );

    // 4) Marcar la solicitud como aprobada y vincular la entrada.
    //    (uq_preq_ticket garantiza que un ticket no se asocia dos veces)
    await conn.query(
      `UPDATE purchase_requests
       SET status = 'approved', approved_by = ?, approved_at = UTC_TIMESTAMP(), ticket_id = ?
       WHERE id = ? AND status = 'pending'`,
      [req.user.id, ticketId, request.id]
    );

    await conn.commit();
    approvedRequest = request;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // La notificación de "nueva compra web" queda resuelta (leída).
  await pool.query(
    "UPDATE notifications SET is_read = 1 WHERE related_type = 'purchase_request' AND related_id = ? AND is_read = 0",
    [approvedRequest.id]
  ).catch(() => {});

  // ---- PDF y correo FUERA de la transacción (igual que la venta
  // manual): si fallan, la aprobación no se revierte; el PDF se
  // regenera bajo demanda y el correo se reenvía desde Entradas.
  const [ticketRows] = await pool.query(
    `SELECT t.*, p.name AS phase_name, u.full_name AS seller_name,
            e.name AS event_name, e.event_date, e.location AS event_location
     FROM tickets t
     JOIN events e ON e.id = t.event_id
     JOIN users u ON u.id = t.seller_id
     LEFT JOIN sale_phases p ON p.id = t.sale_phase_id
     WHERE t.id = ?`,
    [ticketId]
  );
  const ticket = ticketRows[0];

  let emailSent = false;
  let failure = null;
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateTicketPdf(ticket);
    const file = await saveTicketPdf(ticket.event_id, ticket.id, pdfBuffer);
    await pool.query('UPDATE tickets SET pdf_path = ? WHERE id = ?', [file, ticket.id]);
  } catch (err) {
    console.error('Error generando PDF (compra web):', err);
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
    action: 'web_purchase.approve',
    entityType: 'purchase_request',
    entityId: approvedRequest.id,
    metadata: {
      request_code: approvedRequest.request_code,
      ticket_id: ticketId,
      short_code: ticket.short_code,
      price: approvedRequest.price,
      email_sent: emailSent,
    },
  });

  res.json({
    ok: true,
    ticket: { id: ticketId, short_code: ticket.short_code },
    emailSent,
    message: emailSent
      ? `Pago aprobado. Entrada ${ticket.short_code} generada y enviada a ${ticket.customer_email}.`
      : `Pago aprobado y entrada ${ticket.short_code} generada, pero no se pudo enviar el correo. Reenvíala desde Entradas.`,
  });
}));

// ------------------------------------------------------------
// POST /api/purchases/:id/reject — RECHAZAR con motivo obligatorio
// ------------------------------------------------------------
router.post('/:id/reject', ah(async (req, res) => {
  const reason = String((req.body && req.body.reason) || '').trim().slice(0, 300);
  if (reason.length < 3) {
    return res.status(422).json({ error: 'Escribe el motivo del rechazo (mínimo 3 caracteres).' });
  }

  const conn = await pool.getConnection();
  let request;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT * FROM purchase_requests WHERE id = ? FOR UPDATE',
      [String(req.params.id)]
    );
    request = rows[0];
    if (!request) {
      await conn.rollback();
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    if (request.status !== 'pending') {
      await conn.rollback();
      return res.status(409).json({
        error: request.status === 'approved'
          ? 'Esta solicitud ya fue aprobada: anula la entrada desde Entradas si corresponde.'
          : 'Esta solicitud ya estaba rechazada.',
      });
    }
    await conn.query(
      `UPDATE purchase_requests
       SET status = 'rejected', rejected_by = ?, rejected_at = UTC_TIMESTAMP(), rejection_reason = ?
       WHERE id = ? AND status = 'pending'`,
      [req.user.id, reason, request.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // La notificación de "nueva compra web" queda resuelta (leída).
  await pool.query(
    "UPDATE notifications SET is_read = 1 WHERE related_type = 'purchase_request' AND related_id = ? AND is_read = 0",
    [request.id]
  ).catch(() => {});

  // Correo automático al comprador (sin PDF, obviamente).
  const [[eventRow]] = await pool.query('SELECT name FROM events WHERE id = ?', [request.event_id]);
  const emailResult = await sendRequestRejectedEmail(
    { ...request, rejection_reason: reason },
    eventRow ? eventRow.name : 'FLAGS FEST'
  );

  await audit(pool, {
    actorId: req.user.id,
    action: 'web_purchase.reject',
    entityType: 'purchase_request',
    entityId: request.id,
    metadata: { request_code: request.request_code, reason, email_sent: emailResult.ok },
  });

  res.json({
    ok: true,
    emailSent: emailResult.ok,
    message: emailResult.ok
      ? `Solicitud ${request.request_code} rechazada. Se notificó al comprador por correo.`
      : `Solicitud ${request.request_code} rechazada. No se pudo enviar el correo de aviso (revisa SMTP).`,
  });
}));

// ------------------------------------------------------------
// GET /api/purchases/:id — detalle (después de las rutas específicas)
// ------------------------------------------------------------
router.get('/:id', ah(async (req, res) => {
  const request = await loadRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });
  res.json({ request });
}));

module.exports = router;
