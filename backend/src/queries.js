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

// Entradas que consumen cupo de una fase: vendidas o usadas (las
// anuladas lo liberan). Se calcula SIEMPRE desde `tickets` para no
// duplicar contadores que puedan desincronizarse.
async function phaseSoldCount(phaseId, db = pool) {
  const [[{ sold }]] = await db.query(
    "SELECT COUNT(*) AS sold FROM tickets WHERE sale_phase_id = ? AND status IN ('sold','used')",
    [phaseId]
  );
  return Number(sold) || 0;
}

// true si la fase tiene cupo propio y ya se agotó
async function isPhaseSoldOut(phase, db = pool) {
  if (!phase || phase.max_tickets == null) return false;
  const sold = await phaseSoldCount(phase.id, db);
  return sold >= Number(phase.max_tickets);
}

module.exports = { getActiveEvent, getCurrentPhase, phaseSoldCount, isPhaseSoldOut };
