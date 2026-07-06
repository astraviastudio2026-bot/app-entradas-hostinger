const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'entradas_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'entradas_app',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  dateStrings: false,
  timezone: 'local',
});

async function getSetting(key, fallback = null) {
  const [rows] = await pool.query(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    [key]
  );
  return rows.length ? rows[0].setting_value : fallback;
}

module.exports = { pool, getSetting };
