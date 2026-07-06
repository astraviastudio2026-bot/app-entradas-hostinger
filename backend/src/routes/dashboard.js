const express = require('express');
const { pool, getSetting } = require('../db');
const { requireAuth } = require('../middleware');
const { ah } = require('../utils');
const { getActivePhase } = require('./phases');

const router = express.Router();
router.use(requireAuth);

router.get('/', ah(async (req, res) => {
  const totalLimit = Number(await getSetting('total_tickets', '600'));
  const currency = await getSetting('currency_symbol', 'S/');
  const phase = await getActivePhase();

  const [[global]] = await pool.query(
    `SELECT SUM(status <> 'cancelled') AS sold,
            SUM(status = 'used')       AS used,
            SUM(status = 'cancelled')  AS cancelled,
            COALESCE(SUM(IF(status <> 'cancelled', price, 0)), 0) AS revenue
     FROM tickets`
  );
  const globalSold = Number(global.sold) || 0;

  const base = {
    currency,
    active_phase: phase,
    total_limit: totalLimit,
    global_sold: globalSold,
    global_available: Math.max(0, totalLimit - globalSold),
  };

  if (req.user.role === 'admin') {
    const [[{ sellers }]] = await pool.query(
      "SELECT COUNT(*) AS sellers FROM users WHERE role = 'seller' AND is_active = 1"
    );
    const [byColor] = await pool.query(
      `SELECT selected_color AS color, SUM(status <> 'cancelled') AS sold
       FROM tickets GROUP BY selected_color`
    );
    const [recent] = await pool.query(
      `SELECT t.id, t.code, t.buyer_name, t.selected_color, t.price, t.status, t.sold_at, u.name AS seller_name
       FROM tickets t JOIN users u ON u.id = t.seller_id
       ORDER BY t.id DESC LIMIT 8`
    );
    return res.json({
      ...base,
      role: 'admin',
      used: Number(global.used) || 0,
      cancelled: Number(global.cancelled) || 0,
      revenue: Number(global.revenue) || 0,
      active_sellers: sellers,
      by_color: byColor,
      recent_tickets: recent,
    });
  }

  const [[mine]] = await pool.query(
    `SELECT SUM(status <> 'cancelled') AS sold,
            COALESCE(SUM(IF(status <> 'cancelled', price, 0)), 0) AS revenue
     FROM tickets WHERE seller_id = ?`,
    [req.user.id]
  );
  const [[me]] = await pool.query('SELECT quota FROM users WHERE id = ?', [req.user.id]);
  const [recent] = await pool.query(
    `SELECT id, code, buyer_name, selected_color, price, status, sold_at
     FROM tickets WHERE seller_id = ? ORDER BY id DESC LIMIT 8`,
    [req.user.id]
  );
  const mySold = Number(mine.sold) || 0;
  return res.json({
    ...base,
    role: 'seller',
    quota: me ? me.quota : 0,
    my_sold: mySold,
    my_remaining: Math.max(0, (me ? me.quota : 0) - mySold),
    my_revenue: Number(mine.revenue) || 0,
    recent_tickets: recent,
  });
}));

module.exports = router;
