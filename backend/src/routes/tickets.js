const express = require('express');
const crypto = require('crypto');
const { pool, getSetting } = require('../db');
const { requireAuth, requireAdmin, isValidEmail } = require('../middleware');
const { ah } = require('../utils');
const { COLOR_INFO } = require('../colors');
const { generateTicketPdf } = require('../pdf');
const { sendTicketEmail } = require('../mailer');
const { getActivePhase } = require('./phases');

const router = express.Router();
router.use(requireAuth);

const TICKET_SELECT = `
  SELECT t.id, t.code, t.qr_token, t.buyer_name, t.buyer_email, t.selected_color,
         t.price, t.phase_id, t.seller_id, t.status, t.email_sent_at,
         t.sold_at, t.used_at, t.cancelled_at,
         p.name AS phase_name, u.name AS seller_name
  FROM tickets t
  JOIN sale_phases p ON p.id = t.phase_id
  JOIN users u ON u.id = t.seller_id
`;

async function findTicketForUser(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json({ error: 'Entrada no encontrada' });
    return null;
  }
  const [rows] = await pool.query(`${TICKET_SELECT} WHERE t.id = ?`, [id]);
  const ticket = rows[0];
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

// ------------------------------------------------------------
// Listado (vendedor: solo sus ventas)
// ------------------------------------------------------------
router.get('/', ah(async (req, res) => {
  const where = [];
  const params = [];
  if (req.user.role !== 'admin') {
    where.push('t.seller_id = ?');
    params.push(req.user.id);
  } else if (req.query.seller_id) {
    where.push('t.seller_id = ?');
    params.push(Number(req.query.seller_id));
  }
  if (req.query.status && ['sold', 'used', 'cancelled'].includes(req.query.status)) {
    where.push('t.status = ?');
    params.push(req.query.status);
  }
  if (req.query.color && COLOR_INFO[req.query.color]) {
    where.push('t.selected_color = ?');
    params.push(req.query.color);
  }
  if (req.query.phase_id) {
    where.push('t.phase_id = ?');
    params.push(Number(req.query.phase_id));
  }
  if (req.query.q) {
    where.push('(t.code LIKE ? OR t.buyer_name LIKE ? OR t.buyer_email LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `${TICKET_SELECT} ${whereSql} ORDER BY t.id DESC LIMIT 1000`,
    params
  );
  res.json({ tickets: rows });
}));

// ------------------------------------------------------------
// Venta de entrada
// ------------------------------------------------------------
router.post('/sell', ah(async (req, res) => {
  const { buyer_name: buyerName, buyer_email: buyerEmail, selected_color: selectedColor } = req.body || {};
  if (!buyerName || !String(buyerName).trim()) {
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  }
  if (!isValidEmail(buyerEmail)) {
    return res.status(400).json({ error: 'El correo del cliente no es válido' });
  }
  if (!COLOR_INFO[selectedColor]) {
    return res.status(400).json({ error: 'Color inválido. Debe ser verde, rojo o amarillo' });
  }

  const conn = await pool.getConnection();
  let ticketId;
  try {
    await conn.beginTransaction();

    // El lock sobre esta fila serializa todas las ventas y evita
    // sobrepasar el limite global o el cupo bajo concurrencia.
    const [settingRows] = await conn.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'total_tickets' FOR UPDATE"
    );
    const totalLimit = Number(settingRows.length ? settingRows[0].setting_value : 600);

    const [[{ soldTotal }]] = await conn.query(
      "SELECT COUNT(*) AS soldTotal FROM tickets WHERE status <> 'cancelled'"
    );
    if (soldTotal >= totalLimit) {
      await conn.rollback();
      return res.status(409).json({ error: `Se alcanzó el límite total de ${totalLimit} entradas. No se pueden vender más.` });
    }

    const [sellerRows] = await conn.query(
      'SELECT id, name, quota, is_active, role FROM users WHERE id = ?',
      [req.user.id]
    );
    const seller = sellerRows[0];
    if (!seller || !seller.is_active) {
      await conn.rollback();
      return res.status(403).json({ error: 'Tu cuenta está desactivada' });
    }
    if (seller.role !== 'admin') {
      const [[{ mySold }]] = await conn.query(
        "SELECT COUNT(*) AS mySold FROM tickets WHERE seller_id = ? AND status <> 'cancelled'",
        [seller.id]
      );
      if (mySold >= seller.quota) {
        await conn.rollback();
        return res.status(409).json({ error: `Ya vendiste tu cupo asignado de ${seller.quota} entradas.` });
      }
    }

    const phase = await getActivePhase(conn);
    if (!phase) {
      await conn.rollback();
      return res.status(409).json({ error: 'No hay una fase de venta vigente en este momento. Contacta al administrador.' });
    }

    const [[{ maxNum }]] = await conn.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)), 0) AS maxNum FROM tickets"
    );
    const code = `FF-${String(Number(maxNum) + 1).padStart(4, '0')}`;
    const qrToken = crypto.randomBytes(24).toString('hex'); // 48 chars

    const [result] = await conn.query(
      `INSERT INTO tickets (code, qr_token, buyer_name, buyer_email, selected_color, price, phase_id, seller_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sold')`,
      [code, qrToken, String(buyerName).trim(), String(buyerEmail).trim().toLowerCase(), selectedColor, phase.price, phase.id, seller.id]
    );
    ticketId = result.insertId;
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [rows] = await pool.query(`${TICKET_SELECT} WHERE t.id = ?`, [ticketId]);
  const ticket = rows[0];

  // Envio de correo fuera de la transaccion: si falla, la venta queda igual.
  const currency = await getSetting('currency_symbol', 'S/');
  let emailResult = { sent: false, warning: null };
  try {
    const pdfBuffer = await generateTicketPdf(ticket, { currency });
    emailResult = await sendTicketEmail(ticket, pdfBuffer, currency);
  } catch (err) {
    console.error('Error generando PDF para correo:', err.message);
    emailResult = { sent: false, warning: 'La entrada se registró, pero falló la generación del PDF para el correo.' };
  }
  if (emailResult.sent) {
    await pool.query('UPDATE tickets SET email_sent_at = NOW() WHERE id = ?', [ticketId]);
    ticket.email_sent_at = new Date();
  }

  res.status(201).json({
    ticket,
    email_sent: emailResult.sent,
    warning: emailResult.warning,
    message: `Entrada ${ticket.code} registrada correctamente`,
  });
}));

// ------------------------------------------------------------
// Detalle
// ------------------------------------------------------------
router.get('/:id', ah(async (req, res) => {
  const ticket = await findTicketForUser(req, res);
  if (!ticket) return;
  res.json({ ticket });
}));

// ------------------------------------------------------------
// PDF de la entrada
// ------------------------------------------------------------
router.get('/:id/pdf', ah(async (req, res) => {
  const ticket = await findTicketForUser(req, res);
  if (!ticket) return;
  const currency = await getSetting('currency_symbol', 'S/');
  const pdfBuffer = await generateTicketPdf(ticket, { currency });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="FLAGSFEST-${ticket.code}.pdf"`);
  res.send(pdfBuffer);
}));

// ------------------------------------------------------------
// Reenviar entrada por correo
// ------------------------------------------------------------
router.post('/:id/resend', ah(async (req, res) => {
  const ticket = await findTicketForUser(req, res);
  if (!ticket) return;
  if (ticket.status === 'cancelled') {
    return res.status(409).json({ error: 'No se puede reenviar una entrada anulada' });
  }
  const currency = await getSetting('currency_symbol', 'S/');
  const pdfBuffer = await generateTicketPdf(ticket, { currency });
  const emailResult = await sendTicketEmail(ticket, pdfBuffer, currency);
  if (!emailResult.sent) {
    return res.status(502).json({ error: emailResult.warning || 'No se pudo enviar el correo' });
  }
  await pool.query('UPDATE tickets SET email_sent_at = NOW() WHERE id = ?', [ticket.id]);
  res.json({ message: `Entrada ${ticket.code} reenviada a ${ticket.buyer_email}` });
}));

// ------------------------------------------------------------
// Anular entrada (solo admin)
// ------------------------------------------------------------
router.post('/:id/cancel', requireAdmin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT id, code, status FROM tickets WHERE id = ?', [id]);
  const ticket = rows[0];
  if (!ticket) return res.status(404).json({ error: 'Entrada no encontrada' });
  if (ticket.status === 'cancelled') {
    return res.status(409).json({ error: 'La entrada ya está anulada' });
  }
  await pool.query(
    "UPDATE tickets SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?",
    [id]
  );
  res.json({ message: `Entrada ${ticket.code} anulada. Su cupo queda liberado.` });
}));

module.exports = router;
