const { pool } = require('./db');

// Evento activo (el más reciente si hubiera varios; el backend garantiza
// que solo uno quede activo al guardar).
async function getActiveEvent(db = pool) {
  const [rows] = await db.query(
    'SELECT * FROM events WHERE is_active = 1 ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  return rows[0] || null;
}

// Fase vigente de un evento: activa y cuya ventana contiene el momento
// actual (UTC). Si hay varias, gana la de menor phase_order.
async function getCurrentPhase(eventId, db = pool) {
  const [rows] = await db.query(
    `SELECT * FROM sale_phases
     WHERE event_id = ? AND is_active = 1
       AND starts_at <= UTC_TIMESTAMP() AND ends_at >= UTC_TIMESTAMP()
     ORDER BY phase_order ASC
     LIMIT 1`,
    [eventId]
  );
  return rows[0] || null;
}

module.exports = { getActiveEvent, getCurrentPhase };
