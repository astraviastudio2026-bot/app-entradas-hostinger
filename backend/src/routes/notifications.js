// Notificaciones internas del panel (campana). Hoy se generan al
// recibir una compra web pública; el diseño admite otros tipos.
//
// Acceso: admin y seller (organizadores). NUNCA son públicas.
// `is_read` es global: el panel lo comparte todo el equipo y marcar
// una solicitud como atendida por cualquiera la resuelve para todos
// (simple y sin estados duplicados por usuario).
//
//   GET  /api/notifications               últimas 50 (?only_unread=1)
//   GET  /api/notifications/unread-count  contador para el badge (polling)
//   POST /api/notifications/:id/read      marcar una como leída
//   POST /api/notifications/read-all      marcar todas como leídas
const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware');
const { ah } = require('../utils');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'seller'));

// El estado de la solicitud relacionada se une en vivo para que la
// campana muestre "pendiente/aprobada/rechazada" siempre actualizado.
const LIST_SELECT = `
  SELECT n.id, n.type, n.title, n.message, n.related_type, n.related_id,
         n.is_read, n.created_at,
         r.request_code, r.buyer_name, r.selected_color, r.status AS request_status
  FROM notifications n
  LEFT JOIN purchase_requests r
    ON n.related_type = 'purchase_request' AND r.id = n.related_id
`;

router.get('/', ah(async (req, res) => {
  const onlyUnread = ['1', 'true'].includes(String(req.query.only_unread));
  const [rows] = await pool.query(
    `${LIST_SELECT} ${onlyUnread ? 'WHERE n.is_read = 0' : ''}
     ORDER BY n.created_at DESC, n.id DESC LIMIT 50`
  );
  res.json({ notifications: rows });
}));

router.get('/unread-count', ah(async (req, res) => {
  const [[{ unread }]] = await pool.query(
    'SELECT COUNT(*) AS unread FROM notifications WHERE is_read = 0'
  );
  res.json({ unread: Number(unread) || 0 });
}));

router.post('/read-all', ah(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE is_read = 0');
  res.json({ ok: true, message: 'Todas las notificaciones quedaron marcadas como leídas' });
}));

router.post('/:id/read', ah(async (req, res) => {
  const [result] = await pool.query(
    'UPDATE notifications SET is_read = 1 WHERE id = ?',
    [String(req.params.id)]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Notificación no encontrada' });
  res.json({ ok: true });
}));

module.exports = router;
