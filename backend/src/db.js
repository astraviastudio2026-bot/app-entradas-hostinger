const mysql = require('mysql2/promise');

// timezone 'Z': los DATETIME de la BD se interpretan como UTC al leer
// y se escriben en UTC. Toda fecha-hora en la BD está en UTC.
//
// dateStrings ['DATE']: las columnas DATE puras (events.event_date) se
// devuelven como texto 'YYYY-MM-DD', NUNCA como objeto Date. Un DATE no
// tiene hora ni zona horaria: convertirlo a Date (medianoche UTC) hacía
// que el frontend, al pasarlo a hora de Ecuador (UTC-5), mostrara el día
// anterior (30/07/2026 -> 29/07/2026). Los DATETIME siguen siendo Date.
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'entradas_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'entradas_app',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: ['DATE'],
  timezone: 'Z',
});

module.exports = { pool };
