const express = require('express');
const { pool, getSetting } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { ah } = require('../utils');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/summary', ah(async (req, res) => {
  const totalLimit = Number(await getSetting('total_tickets', '600'));
  const currency = await getSetting('currency_symbol', 'S/');

  const [[totals]] = await pool.query(
    `SELECT
       COUNT(*)                                    AS emitted,
       SUM(status <> 'cancelled')                  AS sold,
       SUM(status = 'used')                        AS used,
       SUM(status = 'cancelled')                   AS cancelled,
       COALESCE(SUM(IF(status <> 'cancelled', price, 0)), 0) AS revenue
     FROM tickets`
  );

  const [byColor] = await pool.query(
    `SELECT selected_color AS color,
            SUM(status <> 'cancelled') AS sold,
            COALESCE(SUM(IF(status <> 'cancelled', price, 0)), 0) AS revenue
     FROM tickets GROUP BY selected_color`
  );

  const [byPhase] = await pool.query(
    `SELECT p.id, p.name, p.price,
            COALESCE(SUM(t.status <> 'cancelled'), 0) AS sold,
            COALESCE(SUM(IF(t.status <> 'cancelled', t.price, 0)), 0) AS revenue
     FROM sale_phases p
     LEFT JOIN tickets t ON t.phase_id = p.id
     GROUP BY p.id
     ORDER BY p.start_date ASC`
  );

  res.json({
    currency,
    total_limit: totalLimit,
    sold: Number(totals.sold) || 0,
    available: Math.max(0, totalLimit - (Number(totals.sold) || 0)),
    used: Number(totals.used) || 0,
    cancelled: Number(totals.cancelled) || 0,
    revenue: Number(totals.revenue) || 0,
    by_color: byColor,
    by_phase: byPhase,
  });
}));

router.get('/sellers', ah(async (req, res) => {
  const currency = await getSetting('currency_symbol', 'S/');
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.quota, u.is_active,
            COALESCE(SUM(t.status <> 'cancelled'), 0) AS sold,
            COALESCE(SUM(t.status = 'used'), 0)       AS used,
            COALESCE(SUM(t.status = 'cancelled'), 0)  AS cancelled,
            COALESCE(SUM(IF(t.status <> 'cancelled', t.price, 0)), 0) AS revenue
     FROM users u
     LEFT JOIN tickets t ON t.seller_id = u.id
     WHERE u.role = 'seller'
     GROUP BY u.id
     ORDER BY revenue DESC, u.name ASC`
  );
  res.json({ currency, sellers: rows });
}));

module.exports = router;
