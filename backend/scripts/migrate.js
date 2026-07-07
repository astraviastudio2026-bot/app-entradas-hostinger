#!/usr/bin/env node
// Migración de la base de datos FLAGS FEST.
//
// - En una BD vacía: crea el esquema nuevo (schema.sql).
// - En una instalación legacy (ids INT, login por email): renombra las
//   tablas antiguas a legacy_*, crea el esquema nuevo y copia los datos
//   (usuarios, fases, cupos, entradas con su qr_token original y
//   qr_hash calculado con QR_SECRET, historial de escaneos).
//
// Uso:  node scripts/migrate.js   (o `npm run migrate`)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { uuid, qrHash, normalizeUsername } = require('../src/utils');
const { toMysqlUtc } = require('../src/time');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'entradas_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'entradas_app',
    multipleStatements: true,
    timezone: 'Z',
  });

  let [tables] = await conn.query('SHOW TABLES');
  let names = tables.map((r) => Object.values(r)[0]);

  // Instalación legacy: existe `users` pero sin columna `username`.
  let legacy = false;
  if (names.includes('users') && !names.includes('legacy_users')) {
    const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'username'");
    legacy = cols.length === 0;
  }

  if (legacy) {
    console.log('Instalación legacy detectada: renombrando tablas antiguas a legacy_* …');
    const renames = ['users', 'sale_phases', 'tickets', 'ticket_scans']
      .filter((t) => names.includes(t))
      .map((t) => `\`${t}\` TO \`legacy_${t}\``);
    await conn.query(`RENAME TABLE ${renames.join(', ')}`);
    [tables] = await conn.query('SHOW TABLES');
    names = tables.map((r) => Object.values(r)[0]);
  }

  // Los nombres de constraint son únicos por esquema en MySQL: hay que
  // soltar las FKs de las tablas legacy para poder crear las nuevas.
  for (const t of names.filter((n) => n.startsWith('legacy_'))) {
    const [fks] = await conn.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
      [t]
    );
    for (const fk of fks) {
      await conn.query(`ALTER TABLE \`${t}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
    }
  }

  console.log('Aplicando esquema…');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await conn.query(schema);

  // Columnas nuevas sobre tablas ya existentes (CREATE TABLE IF NOT
  // EXISTS no las agrega). Idempotente: solo si falta la columna.
  await ensureColumn(conn, 'sale_phases', 'max_tickets', 'INT NULL AFTER price');

  // Copia pendiente: hay tablas legacy y la tabla nueva de usuarios está vacía
  // (cubre también una ejecución anterior interrumpida).
  let copyPending = false;
  if (names.includes('legacy_users')) {
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
    copyPending = n === 0;
  }
  if (copyPending) {
    if (!process.env.QR_SECRET) {
      console.error('ERROR: define QR_SECRET en .env antes de migrar datos legacy (se necesita para calcular qr_hash).');
      process.exit(1);
    }
    await migrateLegacy(conn);
  }

  console.log('Migración completada.');
  await conn.end();
}

async function ensureColumn(conn, table, column, definition) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (!cols.length) {
    console.log(`  agregando columna ${table}.${column}…`);
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function migrateLegacy(conn) {
  console.log('Copiando datos legacy…');
  await conn.beginTransaction();
  try {
    // ---- usuarios: el username sale de la parte local del correo ----
    const [oldUsers] = await conn.query('SELECT * FROM legacy_users ORDER BY id');
    const userMap = new Map(); // id legacy -> uuid
    const seen = new Set();
    for (const u of oldUsers) {
      let username = normalizeUsername(u.email) || `usuario${u.id}`;
      while (seen.has(username)) username = `${username}${u.id}`;
      seen.add(username);
      const id = uuid();
      userMap.set(u.id, id);
      await conn.query(
        `INSERT INTO users (id, full_name, username, email, password_hash, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, u.name, username, u.email, u.password_hash, u.role, u.is_active, toMysqlUtc(u.created_at || new Date())]
      );
      console.log(`  usuario ${u.email} -> username "${username}"`);
    }

    // ---- evento único a partir de app_settings ----
    let eventName = 'FLAGS FEST';
    let totalTickets = 600;
    try {
      const [st] = await conn.query('SELECT setting_key, setting_value FROM app_settings');
      for (const row of st) {
        if (row.setting_key === 'event_name') eventName = row.setting_value;
        if (row.setting_key === 'total_tickets') totalTickets = Number(row.setting_value) || 600;
      }
    } catch { /* sin app_settings */ }
    const eventId = uuid();
    await conn.query(
      `INSERT INTO events (id, name, location, event_date, total_tickets, is_active)
       VALUES (?, ?, 'Paradox Club', '2026-07-30', ?, 1)`,
      [eventId, eventName, totalTickets]
    );

    // ---- fases ----
    const [oldPhases] = await conn.query('SELECT * FROM legacy_sale_phases ORDER BY start_date');
    const phaseMap = new Map();
    let order = 1;
    for (const p of oldPhases) {
      const id = uuid();
      phaseMap.set(p.id, id);
      await conn.query(
        `INSERT INTO sale_phases (id, event_id, name, phase_order, starts_at, ends_at, price, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, eventId, p.name, order++, toMysqlUtc(p.start_date), toMysqlUtc(p.end_date), p.price, p.is_active]
      );
    }

    // ---- cupos (columna quota de los vendedores) ----
    for (const u of oldUsers) {
      if (u.role === 'seller' && Number(u.quota) > 0) {
        await conn.query(
          `INSERT INTO seller_allocations (id, event_id, seller_id, allocated_quantity) VALUES (?, ?, ?, ?)`,
          [uuid(), eventId, userMap.get(u.id), Number(u.quota)]
        );
      }
    }

    // ---- entradas ----
    const [oldTickets] = await conn.query('SELECT * FROM legacy_tickets ORDER BY id');
    const ticketMap = new Map();
    let maxNumber = 0;
    for (const t of oldTickets) {
      const id = uuid();
      ticketMap.set(t.id, id);
      const num = Number(String(t.code).replace(/\D/g, '')) || 0;
      maxNumber = Math.max(maxNumber, num);
      await conn.query(
        `INSERT INTO tickets (id, event_id, seller_id, sale_phase_id, ticket_number, short_code,
                              qr_token, qr_hash, customer_name, customer_email, selected_color, price,
                              status, email_sent_at, sold_at, used_at, cancelled_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, eventId, userMap.get(t.seller_id), phaseMap.get(t.phase_id) || null, num, t.code,
          t.qr_token, qrHash(t.qr_token), t.buyer_name, t.buyer_email, t.selected_color, t.price,
          t.status,
          t.email_sent_at ? toMysqlUtc(t.email_sent_at) : null,
          toMysqlUtc(t.sold_at),
          t.used_at ? toMysqlUtc(t.used_at) : null,
          t.cancelled_at ? toMysqlUtc(t.cancelled_at) : null,
          toMysqlUtc(t.sold_at),
        ]
      );
    }
    await conn.query('UPDATE short_code_counter SET `last_value` = GREATEST(`last_value`, ?) WHERE id = 1', [maxNumber]);

    // ---- historial de escaneos ----
    try {
      const [oldScans] = await conn.query('SELECT * FROM legacy_ticket_scans ORDER BY id');
      const messages = {
        valid: 'Entrada válida. Ingreso autorizado.',
        already_used: 'Esta entrada ya fue utilizada.',
        cancelled: 'Esta entrada fue anulada.',
        invalid: 'QR inválido o no registrado.',
      };
      for (const s of oldScans) {
        await conn.query(
          `INSERT INTO ticket_validations (id, ticket_id, validator_id, result, message, metadata, scanned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            uuid(), s.ticket_id ? ticketMap.get(s.ticket_id) || null : null,
            s.scanned_by ? userMap.get(s.scanned_by) || null : null,
            s.result, messages[s.result] || s.result,
            JSON.stringify({ source: 'scanner', legacy: true }),
            toMysqlUtc(s.scanned_at),
          ]
        );
      }
    } catch { /* sin tabla de escaneos */ }

    await conn.query(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata)
       VALUES (?, NULL, 'db.migrate_legacy', 'database', NULL, ?)`,
      [uuid(), JSON.stringify({ users: oldUsers.length, tickets: oldTickets.length })]
    );

    await conn.commit();
    console.log(`Datos migrados: ${oldUsers.length} usuarios, ${oldTickets.length} entradas.`);
    console.log('Las tablas antiguas quedaron como legacy_* (elimínalas cuando verifiques la migración).');
    console.log('AVISO: los logins ahora son por username (parte local del correo). Las contraseñas no cambian.');
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

main().catch((err) => {
  console.error('Error en la migración:', err);
  process.exit(1);
});
