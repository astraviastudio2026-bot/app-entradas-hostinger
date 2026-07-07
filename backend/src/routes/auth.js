const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth, setSessionCookie, clearSessionCookie } = require('../middleware');
const {
  ah, normalizeUsername, isValidEmail, newSecurityToken, hashSecurityToken,
} = require('../utils');
const { toMysqlUtc } = require('../time');
const { sendPasswordResetEmail, sendPasswordChangedEmail } = require('../userMailer');
const { audit } = require('../audit');

const router = express.Router();

const REDIRECTS = { admin: '/admin', seller: '/seller', validator: '/scanner' };

// Bloqueo temporal por cuenta: tras MAX_FAILED contraseñas incorrectas
// seguidas, la cuenta queda bloqueada LOCK_MINUTES (además del rate
// limit por IP). El contador se reinicia con un login correcto.
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
const RESET_TOKEN_MINUTES = 45;
const LOCKED_MESSAGE = 'Demasiados intentos. Intenta nuevamente en unos minutos.';
const GENERIC_LOGIN_ERROR = 'Credenciales incorrectas';

// Hash de relleno: cuando el usuario no existe se compara igual contra
// este hash para que el tiempo de respuesta no revele si existe o no.
const DUMMY_HASH = bcrypt.hashSync('flags-fest-dummy-password', 12);

// Config opcional (apagada por defecto para NUNCA bloquear al admin
// actual): si REQUIRE_VERIFIED_EMAIL_LOGIN=1 en .env, los usuarios CON
// correo vinculado pero sin verificar no pueden iniciar sesión. Los
// usuarios sin correo siempre pueden entrar.
function requireVerifiedEmailForLogin() {
  return ['1', 'true', 'on'].includes(String(process.env.REQUIRE_VERIFIED_EMAIL_LOGIN || '').toLowerCase());
}

function clientIp(req) {
  return String(req.ip || '').slice(0, 45) || null;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Inténtalo de nuevo en unos minutos.' },
});

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de recuperación. Espera unos minutos e inténtalo de nuevo.' },
});

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.' },
});

// ------------------------------------------------------------
// Login con usuario O correo vinculado. Sin ambigüedad: un username
// nunca contiene "@" (validado al crear), así que si el texto trae
// "@" se busca por email y si no, por username.
// ------------------------------------------------------------
router.post('/login', loginLimiter, ah(async (req, res) => {
  const { username, password } = req.body || {};
  const rawInput = String(username || '').trim().toLowerCase();
  if (!rawInput || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }

  const FIELDS = `id, full_name, username, email, role, is_active, password_hash,
                  email_verified_at, failed_login_attempts, locked_until`;
  let rows;
  if (rawInput.includes('@')) {
    [rows] = await pool.query(`SELECT ${FIELDS} FROM users WHERE email = ?`, [rawInput]);
  } else {
    [rows] = await pool.query(`SELECT ${FIELDS} FROM users WHERE username = ?`, [normalizeUsername(rawInput)]);
  }
  const found = rows[0];

  // Cuenta bloqueada temporalmente: ni siquiera se evalúa la contraseña
  // (una contraseña correcta tampoco debe confirmar nada durante el bloqueo).
  if (found && found.locked_until && new Date(found.locked_until).getTime() > Date.now()) {
    return res.status(429).json({ error: LOCKED_MESSAGE });
  }

  // Comparación SIEMPRE (contra un hash de relleno si no hay usuario)
  // para no revelar por tiempos si la cuenta existe.
  const passwordOk = bcrypt.compareSync(password, found ? found.password_hash : DUMMY_HASH);

  if (!found || !passwordOk || !found.is_active) {
    // Solo una contraseña incorrecta de una cuenta real suma intentos.
    if (found && !passwordOk) {
      const attempts = Number(found.failed_login_attempts || 0) + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const until = toMysqlUtc(new Date(Date.now() + LOCK_MINUTES * 60 * 1000));
        await pool.query(
          'UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?',
          [until, found.id]
        );
        await audit(pool, {
          actorId: null,
          action: 'auth.lockout',
          entityType: 'user',
          entityId: found.id,
          metadata: { username: found.username, minutes: LOCK_MINUTES, ip: clientIp(req) },
        });
        return res.status(429).json({ error: LOCKED_MESSAGE });
      }
      await pool.query('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [attempts, found.id]);
    }
    // Mensaje genérico: no revelar si el usuario existe o está inactivo.
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  // Verificación de correo obligatoria (solo si el switch está activo y
  // la cuenta TIENE correo; sin correo siempre entra: el admin actual
  // jamás queda fuera).
  if (requireVerifiedEmailForLogin() && found.email && !found.email_verified_at) {
    return res.status(403).json({
      error: 'Debes verificar tu correo antes de iniciar sesión. Revisa tu bandeja o pide al administrador reenviar la verificación.',
    });
  }

  await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL,
         last_login_at = UTC_TIMESTAMP(), last_login_ip = ?
     WHERE id = ?`,
    [clientIp(req), found.id]
  );

  setSessionCookie(res, found);
  return res.json({
    ok: true,
    redirectTo: REDIRECTS[found.role] || '/',
    user: { id: found.id, full_name: found.full_name, username: found.username, role: found.role },
  });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, ah(async (req, res) => {
  const { id, full_name: fullName, username, email, role } = req.user;
  res.json({
    user: { id, full_name: fullName, username, email, role },
    redirectTo: REDIRECTS[role] || '/',
  });
}));

// ------------------------------------------------------------
// "Olvidé mi contraseña": genera un token de un solo uso (45 min)
// y lo envía al correo vinculado. La respuesta es SIEMPRE genérica
// para no revelar qué correos existen.
// ------------------------------------------------------------
router.post('/forgot-password', forgotLimiter, ah(async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(422).json({ error: 'Ingresa un correo electrónico válido.' });
  }
  const generic = {
    ok: true,
    message: 'Si el correo está vinculado a una cuenta, enviamos un enlace para restablecer la contraseña. Revisa tu bandeja de entrada y spam.',
  };

  const [rows] = await pool.query(
    'SELECT id, full_name, username, email, is_active FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) return res.json(generic);

  const token = newSecurityToken();
  await pool.query(
    'UPDATE users SET password_reset_token = ?, password_reset_expires_at = ? WHERE id = ?',
    [hashSecurityToken(token), toMysqlUtc(new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000)), user.id]
  );
  await sendPasswordResetEmail(user, token);
  await audit(pool, {
    actorId: user.id,
    action: 'auth.password_reset_request',
    entityType: 'user',
    entityId: user.id,
    metadata: { username: user.username, ip: clientIp(req) },
  });
  return res.json(generic);
}));

// ------------------------------------------------------------
// Restablecer contraseña con el token del correo (un solo uso).
// ------------------------------------------------------------
router.post('/reset-password', tokenLimiter, ah(async (req, res) => {
  const token = String((req.body && req.body.token) || '').trim().toLowerCase();
  const password = req.body && req.body.password;
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(422).json({ error: 'El enlace de recuperación es inválido. Solicita uno nuevo desde el login.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(422).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }

  const [rows] = await pool.query(
    `SELECT id, full_name, username, email FROM users
     WHERE password_reset_token = ? AND password_reset_expires_at > UTC_TIMESTAMP() AND is_active = 1
     LIMIT 1`,
    [hashSecurityToken(token)]
  );
  const user = rows[0];
  if (!user) {
    return res.status(410).json({ error: 'El enlace de recuperación expiró o ya fue usado. Solicita uno nuevo desde el login.' });
  }

  // Restablecer contraseña + invalidar el token + desbloquear la cuenta.
  // Usar el enlace del correo también demuestra que el correo es suyo:
  // si aún estaba pendiente, queda verificado.
  await pool.query(
    `UPDATE users
     SET password_hash = ?, password_reset_token = NULL, password_reset_expires_at = NULL,
         failed_login_attempts = 0, locked_until = NULL,
         email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()),
         email_verification_token = NULL, email_verification_expires_at = NULL
     WHERE id = ?`,
    [bcrypt.hashSync(password, 12), user.id]
  );
  await audit(pool, {
    actorId: user.id,
    action: 'auth.password_reset',
    entityType: 'user',
    entityId: user.id,
    metadata: { username: user.username, ip: clientIp(req) },
  });
  // Aviso de seguridad (si falla el correo, el cambio ya está hecho).
  await sendPasswordChangedEmail(user);
  return res.json({ ok: true, message: 'Contraseña restablecida correctamente. Ya puedes iniciar sesión.' });
}));

// ------------------------------------------------------------
// Verificación del correo vinculado (token del correo, un solo uso,
// caduca en 24 h). Público: el usuario solo abre el enlace.
// ------------------------------------------------------------
router.post('/verify-email', tokenLimiter, ah(async (req, res) => {
  const token = String((req.body && req.body.token) || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(422).json({ error: 'El enlace de verificación es inválido.' });
  }

  const [rows] = await pool.query(
    `SELECT id, full_name, username, email, email_verification_expires_at
     FROM users WHERE email_verification_token = ? LIMIT 1`,
    [hashSecurityToken(token)]
  );
  const user = rows[0];
  if (!user) {
    return res.status(410).json({ error: 'El enlace de verificación es inválido o ya fue usado.' });
  }
  if (!user.email_verification_expires_at
    || new Date(user.email_verification_expires_at).getTime() < Date.now()) {
    return res.status(410).json({
      error: 'El enlace de verificación expiró. Pide al administrador reenviar el correo de verificación.',
    });
  }

  await pool.query(
    `UPDATE users
     SET email_verified_at = UTC_TIMESTAMP(),
         email_verification_token = NULL, email_verification_expires_at = NULL
     WHERE id = ?`,
    [user.id]
  );
  await audit(pool, {
    actorId: user.id,
    action: 'user.verify_email',
    entityType: 'user',
    entityId: user.id,
    metadata: { username: user.username, ip: clientIp(req) },
  });
  return res.json({
    ok: true,
    message: 'Correo verificado correctamente. Ya puedes usarlo para iniciar sesión y recuperar tu contraseña.',
    full_name: user.full_name,
  });
}));

module.exports = router;
