const crypto = require('crypto');

// Envuelve handlers async para que los errores lleguen al middleware global.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const uuid = () => crypto.randomUUID();

// SHA-256(token + "." + QR_SECRET): lo que se guarda y por lo que se busca
// al validar. Un QR falsificado sin el secreto nunca produce un hash válido.
function qrHash(token) {
  const secret = process.env.QR_SECRET;
  if (!secret) throw new Error('QR_SECRET no está configurado');
  return crypto.createHash('sha256').update(`${token}.${secret}`).digest('hex');
}

function newQrToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 chars hex
}

// Normaliza el username de login: trim, minúsculas, sin espacios;
// si mandan un correo, usa la parte local.
function normalizeUsername(raw) {
  let u = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (u.includes('@')) u = u.split('@')[0];
  return u;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

// Tokens de un solo uso (verificación de correo / recuperación de
// contraseña). El token en claro viaja SOLO en el enlace del correo;
// en la BD se guarda únicamente su SHA-256 (hex, 64 chars).
function newSecurityToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 chars hex
}

function hashSecurityToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

const COLORS = ['verde', 'rojo', 'amarillo'];

module.exports = {
  ah, uuid, qrHash, newQrToken, normalizeUsername, isValidEmail,
  newSecurityToken, hashSecurityToken, COLORS,
};
