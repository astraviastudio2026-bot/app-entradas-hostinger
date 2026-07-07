const { uuid } = require('./utils');

// Registra una acción en audit_logs. Nunca rompe el flujo principal.
async function audit(db, { actorId = null, action, entityType, entityId = null, metadata = null }) {
  try {
    await db.query(
      'INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), actorId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    console.error('No se pudo registrar auditoría:', err.message);
  }
}

module.exports = { audit };
