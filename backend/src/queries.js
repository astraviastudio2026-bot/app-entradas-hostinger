const { pool } = require('./db');

// Evento activo (el más reciente si hubiera varios; el backend garantiza
// que solo uno quede activo al guardar).
async function getActiveEvent(db = pool) {
  const [rows] = await db.query(
    'SELECT * FROM events WHERE is_active = 1 ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  return rows[0] || null;
}

// true si la fase tiene cupo propio y ya se agotó (sold_count viene
// precalculado en resolveCurrentPhase).
function phaseIsSoldOut(p) {
  return p.max_tickets != null && Number(p.sold_count) >= Number(p.max_tickets);
}

// Fase vigente con AUTO-AVANCE por cupo:
//  - Se parte de las fases activas ordenadas por phase_order.
//  - La fase vigente es la que corresponde por fecha... salvo que su
//    cupo esté agotado: en ese caso se avanza a la SIGUIENTE fase con
//    cupo disponible (aunque su fecha de inicio aún no llegue), que
//    pasa a definir precio y registro de las nuevas ventas.
//  - Una fase que terminó por fecha SIN agotarse no dispara avance:
//    si hay un hueco de calendario entre fases, la venta se pausa
//    (comportamiento original).
//
// Devuelve { phase, allSoldOut, anyStarted }:
//  - phase: fase vigente con cupo disponible, o null.
//  - allSoldOut: true si la venta ya abrió y TODAS las fases restantes
//    agotaron su cupo (el público debe ver "AGOTADO").
//  - anyStarted: true si alguna fase ya inició (la venta abrió).
//
// El consumo de cupo se calcula SIEMPRE desde tickets sold/used
// (pendientes no descuentan, anuladas liberan). Pasar `conn` dentro de
// una transacción con lock del evento para decidir sin carreras.
async function resolveCurrentPhase(eventId, db = pool) {
  const [phases] = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM tickets t
             WHERE t.sale_phase_id = p.id AND t.status IN ('sold','used')) AS sold_count
     FROM sale_phases p
     WHERE p.event_id = ? AND p.is_active = 1
     ORDER BY p.phase_order ASC, p.starts_at ASC`,
    [eventId]
  );

  const now = Date.now();
  const anyStarted = phases.some((p) => new Date(p.starts_at).getTime() <= now);
  const remaining = phases.filter((p) => new Date(p.ends_at).getTime() >= now);
  const allSoldOut = anyStarted && remaining.length > 0 && remaining.every(phaseIsSoldOut);

  let advance = false; // true cuando la fase vigente por fecha agotó su cupo
  for (const p of remaining) {
    const started = new Date(p.starts_at).getTime() <= now;
    if (phaseIsSoldOut(p)) {
      if (started) advance = true;
      continue;
    }
    if (started || advance) return { phase: p, allSoldOut: false, anyStarted };
    break; // fase futura sin avance activado: la venta aún no abre esa fase
  }
  return { phase: null, allSoldOut, anyStarted };
}

// Compatibilidad: la fase vigente "a secas" (con auto-avance incluido).
async function getCurrentPhase(eventId, db = pool) {
  const { phase } = await resolveCurrentPhase(eventId, db);
  return phase;
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

// Métodos de pago ACTIVOS del evento, en orden de visualización.
async function getActivePaymentMethods(eventId, db = pool) {
  const [rows] = await db.query(
    `SELECT * FROM payment_methods
     WHERE event_id = ? AND is_active = 1
     ORDER BY sort_order ASC, created_at ASC`,
    [eventId]
  );
  return rows;
}

module.exports = {
  getActiveEvent, getCurrentPhase, resolveCurrentPhase, phaseSoldCount, getActivePaymentMethods,
};
