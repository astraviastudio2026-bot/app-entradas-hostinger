// Correos de SEGURIDAD de los usuarios internos (admin, vendedores,
// control de acceso): verificación de correo, recuperación de
// contraseña y avisos de seguridad.
//
// Igual que mailer.js / webMailer.js: reutiliza la MISMA configuración
// SMTP (sin variables .env nuevas) y ninguna función lanza excepción
// hacia el flujo principal; devuelven { ok } o { ok: false, error }.
const { smtpConfigured, buildTransport } = require('./mailer');
const { formatEc } = require('./time');

const RED = '#e8112d';

function appUrl() {
  return (process.env.APP_URL || 'https://flagsfest.astraviastudio.cloud').replace(/\/$/, '');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Marco visual común del sistema (club oscuro + rojo FLAGS FEST)
function shell(inner) {
  return `
  <div style="margin:0;padding:24px;background:#050507;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#101014;border:1px solid ${RED};border-radius:14px;overflow:hidden;">
      <div style="background:linear-gradient(120deg,#3d040c,#12060a 70%);padding:28px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:32px;font-weight:bold;letter-spacing:6px;">FLAGS</div>
        <div style="color:#ffffff;font-size:13px;letter-spacing:9px;margin-top:2px;">— FEST —</div>
        <div style="margin-top:8px;font-size:10px;letter-spacing:3px;color:${RED};font-weight:bold;">PANEL INTERNO</div>
      </div>
      <div style="padding:24px;">${inner}</div>
      <div style="padding:12px;text-align:center;border-top:1px solid #26262b;">
        <span style="color:#5c5c64;font-size:9px;letter-spacing:2px;">ASTRAVIA STUDIO</span>
      </div>
    </div>
  </div>`;
}

function button(href, label) {
  return `
  <div style="text-align:center;margin:22px 0;">
    <a href="${href}"
       style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;
              font-weight:bold;font-size:14px;letter-spacing:1px;padding:13px 28px;border-radius:10px;">
      ${label}
    </a>
  </div>
  <p style="color:#5c5c64;font-size:11px;margin:0 0 4px;text-align:center;">
    Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
    <span style="color:#8a8a92;word-break:break-all;">${href}</span>
  </p>`;
}

async function send({ to, subject, html, text }) {
  if (!smtpConfigured()) return { ok: false, error: 'SMTP no configurado' };
  try {
    const transport = buildTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text,
    });
    return { ok: true };
  } catch (err) {
    console.error('Error enviando correo de seguridad:', err.message);
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// 1) Verificación de correo de un usuario interno
//    (el token en claro SOLO viaja aquí; caduca en 24 horas)
// ------------------------------------------------------------
function sendEmailVerificationEmail(user, token) {
  const url = `${appUrl()}/verificar-correo?token=${token}`;
  const html = shell(`
    <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Hola <strong>${esc(user.full_name)}</strong>,</p>
    <p style="color:#b9b9c0;font-size:13px;margin:0 0 6px;">
      Este correo fue vinculado a tu cuenta <strong style="color:#ffffff;">${esc(user.username)}</strong>
      del sistema de entradas <strong style="color:#ffffff;">FLAGS FEST</strong>.
    </p>
    <p style="color:#b9b9c0;font-size:13px;margin:0;">
      Confirma que esta dirección te pertenece para activar la recuperación de contraseña
      y las notificaciones de seguridad:
    </p>
    ${button(url, 'VERIFICAR MI CORREO')}
    <p style="color:#8a8a92;font-size:12px;margin:14px 0 0;">
      ⏱ Este enlace caduca en <strong style="color:#ffffff;">24 horas</strong> y solo puede usarse una vez.
      Si no reconoces esta cuenta, ignora este mensaje.
    </p>`);
  const text = [
    `Hola ${user.full_name},`,
    '',
    `Este correo fue vinculado a tu cuenta "${user.username}" del sistema de entradas FLAGS FEST.`,
    'Confirma que esta dirección te pertenece abriendo este enlace:',
    url,
    '',
    'El enlace caduca en 24 horas y solo puede usarse una vez.',
    'Si no reconoces esta cuenta, ignora este mensaje.',
    '',
    'FLAGS FEST · ASTRAVIA STUDIO',
  ].join('\n');
  return send({
    to: user.email,
    subject: 'Verifica tu correo · Panel FLAGS FEST',
    html,
    text,
  });
}

// ------------------------------------------------------------
// 2) Recuperación de contraseña (token caduca en 45 minutos)
// ------------------------------------------------------------
function sendPasswordResetEmail(user, token) {
  const url = `${appUrl()}/restablecer-contrasena?token=${token}`;
  const html = shell(`
    <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Hola <strong>${esc(user.full_name)}</strong>,</p>
    <p style="color:#b9b9c0;font-size:13px;margin:0;">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta
      <strong style="color:#ffffff;">${esc(user.username)}</strong> del panel FLAGS FEST.
    </p>
    ${button(url, 'RESTABLECER CONTRASEÑA')}
    <p style="color:#8a8a92;font-size:12px;margin:14px 0 0;">
      ⏱ Este enlace caduca en <strong style="color:#ffffff;">45 minutos</strong> y solo puede usarse una vez.
    </p>
    <p style="color:#ffb3b3;font-size:12px;margin:10px 0 0;">
      Si tú no solicitaste este cambio, ignora este correo: tu contraseña actual seguirá funcionando.
    </p>`);
  const text = [
    `Hola ${user.full_name},`,
    '',
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta "${user.username}" del panel FLAGS FEST.`,
    'Abre este enlace para definir una nueva contraseña:',
    url,
    '',
    'El enlace caduca en 45 minutos y solo puede usarse una vez.',
    'Si tú no solicitaste este cambio, ignora este correo.',
    '',
    'FLAGS FEST · ASTRAVIA STUDIO',
  ].join('\n');
  return send({
    to: user.email,
    subject: 'Restablece tu contraseña · Panel FLAGS FEST',
    html,
    text,
  });
}

// ------------------------------------------------------------
// 3) Aviso de seguridad: la contraseña FUE restablecida
// ------------------------------------------------------------
function sendPasswordChangedEmail(user) {
  const when = formatEc(new Date());
  const html = shell(`
    <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Hola <strong>${esc(user.full_name)}</strong>,</p>
    <p style="color:#b9b9c0;font-size:13px;margin:0 0 14px;">
      La contraseña de tu cuenta <strong style="color:#ffffff;">${esc(user.username)}</strong>
      del panel FLAGS FEST fue restablecida el <strong style="color:#ffffff;">${when}</strong> (hora Ecuador).
    </p>
    <p style="color:#ffb3b3;font-size:12px;margin:0;">
      Si tú no realizaste este cambio, contacta INMEDIATAMENTE al administrador del sistema
      para bloquear la cuenta.
    </p>`);
  const text = [
    `Hola ${user.full_name},`,
    '',
    `La contraseña de tu cuenta "${user.username}" del panel FLAGS FEST fue restablecida el ${when} (hora Ecuador).`,
    'Si tú no realizaste este cambio, contacta inmediatamente al administrador del sistema.',
    '',
    'FLAGS FEST · ASTRAVIA STUDIO',
  ].join('\n');
  return send({
    to: user.email,
    subject: 'Tu contraseña fue restablecida · Panel FLAGS FEST',
    html,
    text,
  });
}

// ------------------------------------------------------------
// 4) Aviso OPCIONAL a administradores: nueva compra web recibida.
//    Complementa la campana interna (no la reemplaza). Apagado por
//    defecto: se activa con NOTIFY_PURCHASE_BY_EMAIL=1 en .env y solo
//    escribe a admins con correo VERIFICADO (limitado a 5 destinos).
// ------------------------------------------------------------
function purchaseEmailNotificationsEnabled() {
  return ['1', 'true', 'on'].includes(String(process.env.NOTIFY_PURCHASE_BY_EMAIL || '').toLowerCase());
}

function sendNewPurchaseAdminEmail(recipients, info) {
  const to = (recipients || []).filter(Boolean).slice(0, 5);
  if (!to.length) return Promise.resolve({ ok: false, error: 'Sin destinatarios' });
  const url = `${appUrl()}/compras-web`;
  const html = shell(`
    <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Nueva compra web por validar</p>
    <p style="color:#b9b9c0;font-size:13px;margin:0 0 14px;">
      Se registró la solicitud <strong style="color:${RED};">${esc(info.request_code)}</strong>
      de <strong style="color:#ffffff;">${esc(info.buyer_name)}</strong>
      (${esc(info.flag_label)} · $${Number(info.price).toFixed(2)} · ${esc(info.phase_name)} · ${esc(info.bank_name)}).
    </p>
    ${button(url, 'REVISAR EN EL PANEL')}
    <p style="color:#8a8a92;font-size:11px;margin:10px 0 0;">
      Recibes este aviso porque eres administrador con correo verificado.
      Para dejar de recibirlo, quita NOTIFY_PURCHASE_BY_EMAIL del .env del servidor.
    </p>`);
  const text = [
    'Nueva compra web por validar:',
    `${info.request_code} · ${info.buyer_name} · ${info.flag_label} · $${Number(info.price).toFixed(2)} · ${info.phase_name} · ${info.bank_name}`,
    '',
    `Revísala en: ${url}`,
    '',
    'FLAGS FEST · ASTRAVIA STUDIO',
  ].join('\n');
  return send({
    to: to.join(', '),
    subject: `Nueva compra web ${info.request_code} · FLAGS FEST`,
    html,
    text,
  });
}

module.exports = {
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendNewPurchaseAdminEmail,
  purchaseEmailNotificationsEnabled,
};
