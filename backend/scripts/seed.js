#!/usr/bin/env node
// Seed inicial de FLAGS FEST:
//  - usuario admin (username "admin", contraseña de ADMIN_SEED_PASSWORD
//    o generada e impresa por consola)
//  - evento "FLAGS FEST" (30/07/2026, Paradox Club, 600 entradas) con sus
//    fases de ejemplo: Preventa $8, Fase 1 $12, Fase 2 $15, En puerta $20
//
// Idempotente: no duplica el admin ni el evento si ya existen.
// Uso:  node scripts/seed.js   (o `npm run seed`)
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { uuid } = require('../src/utils');
const { ecDayStartUtc, ecDayEndUtc } = require('../src/time');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'entradas_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'entradas_app',
    timezone: 'Z',
  });

  // ---- admin ----
  const [admins] = await conn.query("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1");
  if (admins.length) {
    console.log(`Ya existe un admin (username "${admins[0].username}"), no se crea otro.`);
  } else {
    const password = process.env.ADMIN_SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
    await conn.query(
      `INSERT INTO users (id, full_name, username, password_hash, role, is_active)
       VALUES (?, 'Administrador', 'admin', ?, 'admin', 1)`,
      [uuid(), bcrypt.hashSync(password, 12)]
    );
    console.log('Admin creado -> username: admin');
    if (process.env.ADMIN_SEED_PASSWORD) {
      console.log('  contraseña: (la de ADMIN_SEED_PASSWORD en .env)');
    } else {
      console.log(`  contraseña generada: ${password}`);
      console.log('  GUÁRDALA: no se volverá a mostrar.');
    }
  }

  // ---- evento + fases ----
  const [events] = await conn.query('SELECT id, name FROM events LIMIT 1');
  if (events.length) {
    console.log(`Ya existe el evento "${events[0].name}", no se crean evento ni fases.`);
  } else {
    const eventId = uuid();
    await conn.query(
      `INSERT INTO events (id, name, location, event_date, total_tickets, is_active)
       VALUES (?, 'FLAGS FEST', 'Paradox Club', '2026-07-30', 600, 1)`,
      [eventId]
    );
    // Días en hora de Ecuador convertidos a UTC
    const phases = [
      ['Preventa', 1, '2026-07-01', '2026-07-14', 8.0],
      ['Fase 1', 2, '2026-07-15', '2026-07-22', 12.0],
      ['Fase 2', 3, '2026-07-23', '2026-07-29', 15.0],
      ['En puerta', 4, '2026-07-30', '2026-07-30', 20.0],
    ];
    for (const [name, order, from, to, price] of phases) {
      await conn.query(
        `INSERT INTO sale_phases (id, event_id, name, phase_order, starts_at, ends_at, price, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [uuid(), eventId, name, order, ecDayStartUtc(from), ecDayEndUtc(to), price]
      );
    }
    console.log('Evento "FLAGS FEST" (30/07/2026, Paradox Club, 600 entradas) y 4 fases creados.');
  }

  await conn.end();
}

main().catch((err) => {
  console.error('Error en el seed:', err);
  process.exit(1);
});
