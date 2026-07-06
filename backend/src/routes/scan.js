const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { ah } = require('../utils');
const { COLOR_INFO } = require('../colors');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// POST /api/scan  { token }
// Valida un QR y marca la entrada como usada si corresponde.
router.post('/', ah(async (req, res) => {
  const token = String((req.body && req.body.token) || '').trim();
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT t.id, t.code, t.buyer_name, t.selected_color, t.status, t.used_at, t.cancelled_at,
              p.name AS phase_name, u.name AS seller_name
       FROM tickets t
       JOIN sale_phases p ON p.id = t.phase_id
       JOIN users u ON u.id = t.seller_id
       WHERE t.qr_token = ?
       FOR UPDATE`,
      [token]
    );
    const ticket = rows[0];

    const logScan = (ticketId, result) =>
      conn.query(
        'INSERT INTO ticket_scans (ticket_id, scanned_by, qr_token, result) VALUES (?, ?, ?, ?)',
        [ticketId, req.user.id, token.slice(0, 48), result]
      );

    if (!ticket) {
      await logScan(null, 'invalid');
      await conn.commit();
      return res.json({ result: 'invalid', message: 'QR inválido: esta entrada no existe.' });
    }

    const color = COLOR_INFO[ticket.selected_color];
    const base = {
      code: ticket.code,
      buyer_name: ticket.buyer_name,
      color: ticket.selected_color,
      color_label: color ? `${color.label} · ${color.concept}` : ticket.selected_color,
      phase_name: ticket.phase_name,
      seller_name: ticket.seller_name,
    };

    if (ticket.status === 'cancelled') {
      await logScan(ticket.id, 'cancelled');
      await conn.commit();
      return res.json({ result: 'cancelled', ticket: base, cancelled_at: ticket.cancelled_at, message: `Entrada ${ticket.code} ANULADA. No permitir el ingreso.` });
    }
    if (ticket.status === 'used') {
      await logScan(ticket.id, 'already_used');
      await conn.commit();
      return res.json({ result: 'already_used', ticket: base, used_at: ticket.used_at, message: `Entrada ${ticket.code} YA FUE USADA.` });
    }

    await conn.query("UPDATE tickets SET status = 'used', used_at = NOW() WHERE id = ?", [ticket.id]);
    await logScan(ticket.id, 'valid');
    await conn.commit();
    return res.json({ result: 'valid', ticket: base, used_at: new Date(), message: `Entrada ${ticket.code} VÁLIDA. Acceso permitido.` });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// GET /api/scan/history — historial de escaneos
router.get('/history', ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, s.result, s.scanned_at, s.qr_token,
            t.code, t.buyer_name, t.selected_color,
            u.name AS scanned_by_name
     FROM ticket_scans s
     LEFT JOIN tickets t ON t.id = s.ticket_id
     LEFT JOIN users u ON u.id = s.scanned_by
     ORDER BY s.id DESC
     LIMIT 300`
  );
  res.json({ scans: rows });
}));

module.exports = router;
