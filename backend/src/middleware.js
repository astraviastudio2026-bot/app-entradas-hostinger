const jwt = require('jsonwebtoken');
const { pool } = require('./db');
const { ah } = require('./utils');

const COOKIE_NAME = 'ff_session';
const SESSION_HOURS = 12;

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no está configurado');
  return secret;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret(), { expiresIn: `${SESSION_HOURS}h` });
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_HOURS * 3600 * 1000,
  };
}

function setSessionCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

// Verifica el JWT (cookie httpOnly; se acepta Bearer como respaldo para
// herramientas) y RELEE el usuario de la BD: desactivar una cuenta la
// expulsa de inmediato. Esto sustituye a las políticas RLS de Supabase.
const requireAuth = ah(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const raw = (req.cookies && req.cookies[COOKIE_NAME]) ||
    (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!raw) return res.status(401).json({ error: 'No autenticado' });

  let payload;
  try {
    payload = jwt.verify(raw, jwtSecret());
  } catch {
    return res.status(401).json({ error: 'Sesión expirada o inválida' });
  }

  const [rows] = await pool.query(
    'SELECT id, full_name, username, email, role, is_active FROM users WHERE id = ?',
    [payload.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Sesión expirada o inválida' });
  }
  req.user = user;
  return next();
});

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, setSessionCookie, clearSessionCookie, COOKIE_NAME };
