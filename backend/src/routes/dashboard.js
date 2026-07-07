const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { ah } = require('../utils');
const { getActiveEvent, getCurrentPhase } = require('../queries');

const router = express.Router();
router.use(requireAuth);

// Contexto de venta para cualquier rol: evento activo, fase vigente y,
// para vendedores, su cupo y ventas. El panel completo de administración
// vive en GET /api/admin/dashboard.
router.get('/', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) {
    return res.json({ event: null, phase: null, message: 'No hay evento activo configurado.' });
  }
  const phase = await getCurrentPhase(event.id);

  const [[{ globalSold }]] = await pool.query(
    "SELECT COUNT(*) AS globalSold FROM tickets WHERE event_id = ? AND status <> 'cancelled'",
    [event.id]
  );
  // Correlativo estimado para la vista previa del ticket (el definitivo
  // lo asigna la transacción de venta; las anuladas conservan su número).
  const [[{ maxNum }]] = await pool.query(
    'SELECT COALESCE(MAX(ticket_number), 0) AS maxNum FROM tickets WHERE event_id = ?',
    [event.id]
  );
  const base = {
    event: {
      id: event.id,
      name: event.name,
      location: event.location,
      event_date: event.event_date,
      total_tickets: event.total_tickets,
    },
    phase: phase ? { id: phase.id, name: phase.name, price: phase.price, ends_at: phase.ends_at } : null,
    global_sold: Number(globalSold) || 0,
    global_available: Math.max(0, event.total_tickets - (Number(globalSold) || 0)),
    next_ticket_number: (Number(maxNum) || 0) + 1,
    role: req.user.role,
  };

  if (req.user.role === 'seller') {
    const [alloc] = await pool.query(
      'SELECT allocated_quantity FROM seller_allocations WHERE event_id = ? AND seller_id = ?',
      [event.id, req.user.id]
    );
    const [[mine]] = await pool.query(
      `SELECT SUM(status <> 'cancelled') AS sold,
              COALESCE(SUM(IF(status <> 'cancelled', price, 0)), 0) AS revenue
       FROM tickets WHERE event_id = ? AND seller_id = ?`,
      [event.id, req.user.id]
    );
    const quota = alloc.length ? alloc[0].allocated_quantity : null; // null = sin cupo asignado
    const sold = Number(mine.sold) || 0;
    return res.json({
      ...base,
      quota,
      my_sold: sold,
      my_remaining: quota === null ? 0 : Math.max(0, quota - sold),
      my_revenue: Number(mine.revenue) || 0,
    });
  }

  if (req.user.role === 'admin') {
    // El admin vende sin cupo propio: solo aplica el límite global.
    return res.json({ ...base, quota: null, my_remaining: base.global_available });
  }

  return res.json(base);
}));

module.exports = router;
