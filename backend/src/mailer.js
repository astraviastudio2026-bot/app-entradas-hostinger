const nodemailer = require('nodemailer');
const { COLOR_INFO, TAGLINE } = require('./colors');

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildTransport() {
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function ticketEmailHtml(ticket, currency) {
  const color = COLOR_INFO[ticket.selected_color] || COLOR_INFO.verde;
  return `
  <div style="margin:0;padding:24px;background:#0b0b0d;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#131316;border:1px solid ${color.hex};border-radius:14px;overflow:hidden;">
      <div style="background:linear-gradient(90deg,${color.midBg},${color.darkBg});padding:28px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:30px;font-weight:bold;letter-spacing:4px;">FLAGS</div>
        <div style="color:#ffffff;font-size:13px;letter-spacing:8px;margin-top:2px;">— FEST —</div>
        <div style="margin-top:8px;font-size:10px;letter-spacing:1px;">
          <span style="color:${COLOR_INFO.verde.hex};">GREEN FLAGS</span>
          <span style="color:#ffffff;"> &amp; </span>
          <span style="color:${COLOR_INFO.rojo.hex};">RED FLAGS</span>
          <span style="color:#ffffff;"> PARTY</span>
        </div>
      </div>
      <div style="padding:24px;">
        <p style="color:#ffffff;font-size:15px;margin:0 0 6px;">Hola <strong>${ticket.buyer_name}</strong>,</p>
        <p style="color:#b9b9c0;font-size:13px;margin:0 0 18px;">
          Tu entrada para <strong style="color:#ffffff;">FLAGS FEST</strong> está confirmada.
          La encontrarás adjunta en PDF: preséntala (impresa o en tu celular) en el ingreso.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 0;color:#8a8a92;">Código</td><td style="padding:6px 0;color:#ffffff;text-align:right;font-weight:bold;letter-spacing:2px;">${ticket.code}</td></tr>
          <tr><td style="padding:6px 0;color:#8a8a92;">Color elegido</td><td style="padding:6px 0;text-align:right;color:${color.hex};font-weight:bold;">${color.label} · ${color.concept}</td></tr>
          <tr><td style="padding:6px 0;color:#8a8a92;">Fase</td><td style="padding:6px 0;color:#ffffff;text-align:right;">${ticket.phase_name || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#8a8a92;">Precio</td><td style="padding:6px 0;color:#ffffff;text-align:right;">${currency} ${Number(ticket.price).toFixed(2)}</td></tr>
        </table>
        <div style="margin-top:18px;padding:12px;border:1px dashed ${color.hex};border-radius:10px;text-align:center;">
          <div style="color:${color.hex};font-size:13px;font-weight:bold;">${color.concept}</div>
          <div style="color:#b9b9c0;font-size:12px;margin-top:2px;">${color.description}</div>
        </div>
        <p style="color:#8a8a92;font-size:11px;text-align:center;margin:20px 0 0;letter-spacing:1px;">${TAGLINE.toUpperCase()}</p>
        <p style="color:#5c5c64;font-size:10px;text-align:center;margin:6px 0 0;">Entrada única e intransferible · No compartas tu QR</p>
      </div>
      <div style="padding:12px;text-align:center;border-top:1px solid #26262b;">
        <span style="color:#5c5c64;font-size:9px;letter-spacing:2px;">ASTRAVIA STUDIO</span>
      </div>
    </div>
  </div>`;
}

// Envia la entrada por correo. Nunca lanza excepcion: devuelve
// { sent, warning } para que la venta se complete aunque falle el correo.
async function sendTicketEmail(ticket, pdfBuffer, currency) {
  if (!smtpConfigured()) {
    return { sent: false, warning: 'SMTP no configurado: la entrada se guardó pero no se envió por correo.' };
  }
  try {
    const transport = buildTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ticket.buyer_email,
      subject: `Tu entrada FLAGS FEST · ${ticket.code}`,
      html: ticketEmailHtml(ticket, currency),
      attachments: [
        {
          filename: `FLAGSFEST-${ticket.code}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
    return { sent: true, warning: null };
  } catch (err) {
    console.error('Error enviando correo:', err.message);
    return { sent: false, warning: `No se pudo enviar el correo al cliente (${err.message}). La entrada quedó registrada.` };
  }
}

module.exports = { sendTicketEmail, smtpConfigured };
