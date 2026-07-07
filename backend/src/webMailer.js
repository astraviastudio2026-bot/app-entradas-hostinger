// Correos del flujo de compras web (venta pública con validación
// manual de pagos). El correo de la ENTRADA aprobada NO vive aquí:
// se reutiliza sendTicketEmail de mailer.js (mismo PDF y plantilla
// que una venta manual).
//
// Igual que mailer.js: ninguna función lanza excepción hacia el flujo
// principal; devuelven { ok } o { ok: false, error }.
const { smtpConfigured, buildTransport } = require('./mailer');
const { COLOR_INFO, CURRENCY } = require('./colors');
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

// Marco visual común: club oscuro, rojo intenso (referencia-3-flags-fest)
function shell(inner) {
  return `
  <div style="margin:0;padding:24px;background:#050507;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#101014;border:1px solid ${RED};border-radius:14px;overflow:hidden;">
      <div style="background:linear-gradient(120deg,#3d040c,#12060a 70%);padding:28px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:32px;font-weight:bold;letter-spacing:6px;">FLAGS</div>
        <div style="color:#ffffff;font-size:13px;letter-spacing:9px;margin-top:2px;">— FEST —</div>
        <div style="margin-top:8px;font-size:10px;letter-spacing:3px;color:${RED};font-weight:bold;">RAVE &#215; REGUETON</div>
      </div>
      <div style="padding:24px;">${inner}</div>
      <div style="padding:12px;text-align:center;border-top:1px solid #26262b;">
        <span style="color:#5c5c64;font-size:9px;letter-spacing:2px;">ASTRAVIA STUDIO</span>
      </div>
    </div>
  </div>`;
}

function rowsTable(rows) {
  return `
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    ${rows.map(([k, v]) => `
      <tr>
        <td style="padding:6px 0;color:#8a8a92;">${k}</td>
        <td style="padding:6px 0;color:#ffffff;text-align:right;font-weight:bold;">${v}</td>
      </tr>`).join('')}
  </table>`;
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
    console.error('Error enviando correo web:', err.message);
    return { ok: false, error: err.message };
  }
}

// ------------------------------------------------------------
// 1) Solicitud recibida (SIN entrada, SIN QR, SIN PDF)
// ------------------------------------------------------------
function sendRequestReceivedEmail(request, eventName) {
  const color = COLOR_INFO[request.selected_color] || COLOR_INFO.verde;
  const statusUrl = `${appUrl()}/estado-compra`;
  const html = shell(`
    <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Hola <strong>${esc(request.buyer_name)}</strong>,</p>
    <p style="color:#b9b9c0;font-size:13px;margin:0 0 18px;">
      Tu solicitud fue recibida correctamente. Guarda este código para consultar el estado de tu compra:
    </p>
    <div style="margin:0 0 18px;padding:16px;border:1px dashed ${RED};border-radius:10px;text-align:center;">
      <div style="color:#8a8a92;font-size:10px;letter-spacing:2px;">CÓDIGO DE SEGUIMIENTO</div>
      <div style="color:${RED};font-size:26px;font-weight:bold;letter-spacing:4px;margin-top:4px;">${esc(request.request_code)}</div>
    </div>
    ${rowsTable([
      ['Evento', esc(eventName || 'FLAGS FEST')],
      ['Estado', '<span style="color:#ffc61a;">PENDIENTE DE VALIDACIÓN</span>'],
      ['Tipo de entrada', `<span style="color:${color.hex};">${color.label} · ${esc(color.concept)}</span>`],
      ['Precio registrado', `${CURRENCY} ${Number(request.price).toFixed(2)}`],
      ['Fase', esc(request.phase_name || '-')],
    ])}
    <p style="color:#b9b9c0;font-size:13px;margin:18px 0 0;">
      Cuando validemos tu pago, recibirás tu <strong style="color:#ffffff;">entrada con QR en PDF</strong> en este mismo correo.
      Este mensaje solo confirma que recibimos tu solicitud: <strong style="color:#ffffff;">aún no es tu entrada</strong>.
    </p>
    <p style="color:#8a8a92;font-size:12px;margin:14px 0 0;">
      Puedes consultar el estado en cualquier momento en
      <a href="${statusUrl}" style="color:${RED};font-weight:bold;">${statusUrl}</a>
      con tu código y tu correo.
    </p>`);
  const text = [
    `Hola ${request.buyer_name},`,
    '',
    'Tu solicitud fue recibida correctamente.',
    `Tu código de seguimiento es: ${request.request_code}`,
    '',
    `Evento: ${eventName || 'FLAGS FEST'}`,
    'Estado: PENDIENTE DE VALIDACIÓN',
    `Tipo de entrada: ${color.label} · ${color.concept}`,
    `Precio registrado: ${CURRENCY} ${Number(request.price).toFixed(2)}`,
    '',
    'Guarda este código para consultar el estado de tu compra.',
    'Cuando validemos tu pago, recibirás tu entrada en el correo registrado.',
    `Consulta el estado en: ${appUrl()}/estado-compra`,
    '',
    'FLAGS FEST · ASTRAVIA STUDIO',
  ].join('\n');
  return send({
    to: request.buyer_email,
    subject: `Recibimos tu solicitud ${request.request_code} · FLAGS FEST`,
    html,
    text,
  });
}

// ------------------------------------------------------------
// 2) Solicitud rechazada (con motivo)
// ------------------------------------------------------------
function sendRequestRejectedEmail(request, eventName) {
  const html = shell(`
    <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Hola <strong>${esc(request.buyer_name)}</strong>,</p>
    <p style="color:#b9b9c0;font-size:13px;margin:0 0 18px;">
      Revisamos tu solicitud de compra para <strong style="color:#ffffff;">${esc(eventName || 'FLAGS FEST')}</strong>
      y no pudimos validar el pago.
    </p>
    ${rowsTable([
      ['Código de solicitud', esc(request.request_code)],
      ['Estado', '<span style="color:#ff4040;">RECHAZADA</span>'],
    ])}
    <div style="margin:18px 0 0;padding:14px;border:1px solid rgba(255,64,64,0.5);border-radius:10px;background:rgba(255,64,64,0.06);">
      <div style="color:#8a8a92;font-size:10px;letter-spacing:2px;">MOTIVO</div>
      <div style="color:#ffb3b3;font-size:13px;margin-top:4px;">${esc(request.rejection_reason || 'No especificado')}</div>
    </div>
    <p style="color:#b9b9c0;font-size:13px;margin:18px 0 0;">
      Si consideras que hubo un error, comunícate con la organización para revisar tu caso.
    </p>`);
  const text = [
    `Hola ${request.buyer_name},`,
    '',
    `Tu solicitud ${request.request_code} para ${eventName || 'FLAGS FEST'} fue RECHAZADA.`,
    `Motivo: ${request.rejection_reason || 'No especificado'}`,
    '',
    'Si consideras que hubo un error, comunícate con la organización.',
    '',
    'FLAGS FEST · ASTRAVIA STUDIO',
  ].join('\n');
  return send({
    to: request.buyer_email,
    subject: `Tu solicitud ${request.request_code} no fue validada · FLAGS FEST`,
    html,
    text,
  });
}

// ------------------------------------------------------------
// 3) Recuperación de código: resumen de solicitudes recientes
//    (solo por correo; nunca se muestra en pantalla)
// ------------------------------------------------------------
const STATUS_ES = { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };
const STATUS_COLOR = { pending: '#ffc61a', approved: '#2fd956', rejected: '#ff4040' };

function sendCodeRecoveryEmail(email, requests, eventName) {
  const rows = requests.map((r) => {
    const color = COLOR_INFO[r.selected_color] || COLOR_INFO.verde;
    return `
    <tr>
      <td style="padding:8px 6px;color:${RED};font-weight:bold;letter-spacing:1px;font-size:12px;">${esc(r.request_code)}</td>
      <td style="padding:8px 6px;color:${STATUS_COLOR[r.status] || '#fff'};font-size:12px;font-weight:bold;">${STATUS_ES[r.status] || r.status}</td>
      <td style="padding:8px 6px;color:${color.hex};font-size:12px;">${color.label}</td>
      <td style="padding:8px 6px;color:#b9b9c0;font-size:12px;">${formatEc(r.created_at)}</td>
    </tr>`;
  }).join('');
  const html = shell(`
    <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Hola,</p>
    <p style="color:#b9b9c0;font-size:13px;margin:0 0 18px;">
      Pediste recuperar tu código de solicitud para
      <strong style="color:#ffffff;">${esc(eventName || 'FLAGS FEST')}</strong>.
      Estas son tus solicitudes recientes registradas con este correo:
    </p>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <th style="text-align:left;padding:6px;color:#8a8a92;font-size:10px;letter-spacing:1px;">CÓDIGO</th>
        <th style="text-align:left;padding:6px;color:#8a8a92;font-size:10px;letter-spacing:1px;">ESTADO</th>
        <th style="text-align:left;padding:6px;color:#8a8a92;font-size:10px;letter-spacing:1px;">ENTRADA</th>
        <th style="text-align:left;padding:6px;color:#8a8a92;font-size:10px;letter-spacing:1px;">FECHA</th>
      </tr>
      ${rows}
    </table>
    <p style="color:#8a8a92;font-size:12px;margin:16px 0 0;">
      Consulta el estado con tu código y este correo en
      <a href="${appUrl()}/estado-compra" style="color:${RED};font-weight:bold;">${appUrl()}/estado-compra</a>.
      Si no solicitaste este correo, puedes ignorarlo.
    </p>`);
  const text = [
    'Hola,',
    '',
    `Tus solicitudes recientes para ${eventName || 'FLAGS FEST'}:`,
    '',
    ...requests.map((r) => {
      const color = COLOR_INFO[r.selected_color] || COLOR_INFO.verde;
      return `- ${r.request_code} · ${STATUS_ES[r.status] || r.status} · ${color.label} · ${formatEc(r.created_at)}`;
    }),
    '',
    `Consulta el estado en: ${appUrl()}/estado-compra`,
    '',
    'FLAGS FEST · ASTRAVIA STUDIO',
  ].join('\n');
  return send({
    to: email,
    subject: 'Tus códigos de solicitud · FLAGS FEST',
    html,
    text,
  });
}

module.exports = { sendRequestReceivedEmail, sendRequestRejectedEmail, sendCodeRecoveryEmail };
