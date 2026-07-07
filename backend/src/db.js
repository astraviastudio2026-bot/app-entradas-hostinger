const mysql = require('mysql2/promise');

// timezone 'Z': los DATETIME de la BD se interpretan como UTC al leer
// y se escriben en UTC. Toda fecha en la BD está en UTC.
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'entradas_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'entradas_app',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: false,
  timezone: 'Z',
});

module.exports = { pool };
