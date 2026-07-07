const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { COLOR_INFO, TAGLINE, CURRENCY } = require('./colors');
const { formatEc, formatDateOnly } = require('./time');

// Logo de ASTRAVIA STUDIO (branding secundario del pie de página).
// Se busca en rutas conocidas para que funcione igual en el Codespace y
// en Hostinger (el backend siempre lee su propia copia en backend/assets;
// las demás son respaldos). Si no aparece, el PDF SE GENERA IGUAL sin
// logo y se deja una advertencia en el log: nunca rompe una venta.
let astraviaLogo; // undefined = aún no buscado; null = no disponible
function getAstraviaLogo() {
  if (astraviaLogo !== undefined) return astraviaLogo;
  const candidates = [
    process.env.ASTRAVIA_LOGO_PATH,
    path.join(__dirname, '..', 'assets', 'astravia-logo.jpg'),
    path.join(__dirname, '..', '..', 'assets', 'referencias', 'astravia-logo.jpg'),
    path.join(__dirname, '..', '..', 'frontend', 'public', 'astravia-logo.jpg'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      astraviaLogo = fs.readFileSync(file);
      return astraviaLogo;
    } catch { /* probar la siguiente ruta */ }
  }
  astraviaLogo = null;
  console.warn('AVISO: no se encontró backend/assets/astravia-logo.jpg; el PDF se genera sin el logo del estudio.');
  return astraviaLogo;
}

// Entrada en A4 horizontal, estética nightclub, inspirada en
// assets/referencias/formato-entrada.png: franja tipo pulsera con muescas
// laterales, degradado oscuro teñido del color elegido, logo FLAGS FEST,
// concepto neón al centro, talón con el nº de entrada y QR a la derecha.
// El QR contiene SOLO la URL de validación (sin datos personales).
const PAGE_W = 842;  // A4 apaisado
const PAGE_H = 595;

// Recorta un texto para que quepa en una sola línea de ancho maxW.
function fitText(doc, str, maxW) {
  let s = String(str);
  if (doc.widthOfString(s) <= maxW) return s;
  while (s.length > 1 && doc.widthOfString(`${s}…`) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function drawSparkle(doc, x, y, size, color, opacity) {
  doc.save();
  doc.lineWidth(1.2).strokeColor(color, opacity);
  doc.moveTo(x - size, y).lineTo(x + size, y).stroke();
  doc.moveTo(x, y - size).lineTo(x, y + size).stroke();
  doc.restore();
}

function drawHeart(doc, cx, cy, size, color) {
  const s = size;
  doc.save();
  doc.lineWidth(2.2).strokeColor(color, 0.95);
  doc
    .moveTo(cx, cy + s * 0.85)
    .bezierCurveTo(cx - s * 1.4, cy - s * 0.1, cx - s * 0.75, cy - s * 1.05, cx, cy - s * 0.35)
    .bezierCurveTo(cx + s * 0.75, cy - s * 1.05, cx + s * 1.4, cy - s * 0.1, cx, cy + s * 0.85)
    .stroke();
  doc.restore();
}

function drawFlags(doc, cx, cy, color) {
  doc.save();
  doc.lineWidth(1.6).strokeColor(color, 0.9);
  doc.moveTo(cx + 3, cy + 16).lineTo(cx - 13, cy - 14).stroke();
  doc.moveTo(cx - 3, cy + 16).lineTo(cx + 13, cy - 14).stroke();
  doc.fillColor(color, 0.9);
  doc.moveTo(cx - 13, cy - 14).lineTo(cx - 30, cy - 10).lineTo(cx - 15, cy - 5).closePath().fill();
  doc.moveTo(cx + 13, cy - 14).lineTo(cx + 30, cy - 10).lineTo(cx + 15, cy - 5).closePath().fill();
  doc.restore();
}

// ticket: short_code, ticket_number, qr_token, customer_name, customer_email,
// selected_color, price, sold_at, phase_name, seller_name, event_name,
// event_date, event_location.
async function generateTicketPdf(ticket) {
  const color = COLOR_INFO[ticket.selected_color] || COLOR_INFO.verde;
  const appUrl = (process.env.APP_URL || 'https://flagsfest.astraviastudio.cloud').replace(/\/$/, '');
  const validateUrl = `${appUrl}/ticket/validate/${ticket.qr_token}`;

  const qrPng = await QRCode.toBuffer(validateUrl, {
    errorCorrectionLevel: 'M',
    width: 600,
    margin: 1,
    color: { dark: '#0a0a0a', light: '#ffffff' },
  });

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margin: 0,
    info: {
      Title: `FLAGS FEST - Entrada ${ticket.short_code}`,
      Author: 'FLAGS FEST · ASTRAVIA STUDIO',
    },
  });

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // ---- fondo de página ----
  doc.rect(0, 0, PAGE_W, PAGE_H).fill('#050508');

  // encabezado sutil sobre el ticket
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff', 0.35);
  doc.text((ticket.event_name || 'FLAGS FEST').toUpperCase(), 0, 96, { width: PAGE_W, align: 'center', characterSpacing: 6 });

  // ---- cuerpo del ticket (centrado en la página) ----
  const tx = 22;
  const th = 216;
  const bandH = 62;
  const gap = 14;
  const ty = (PAGE_H - (th + gap + bandH)) / 2;
  const tw = PAGE_W - 44;

  doc.save();
  doc.roundedRect(tx, ty, tw, th, 16).clip();

  const grad = doc.linearGradient(tx, ty, tx + tw, ty);
  grad.stop(0, color.midBg).stop(0.28, color.darkBg).stop(0.62, color.darkBg).stop(1, color.midBg);
  doc.rect(tx, ty, tw, th).fill(grad);

  // talón izquierdo en color pleno con el nº de entrada vertical
  const tabW = 58;
  const tabGrad = doc.linearGradient(tx, ty, tx + tabW, ty);
  tabGrad.stop(0, color.hex).stop(1, color.midBg);
  doc.rect(tx, ty, tabW, th).fill(tabGrad);

  const ticketNo = `Nº ${String(ticket.ticket_number || 0).padStart(4, '0')}`;
  doc.save();
  doc.rotate(-90, { origin: [tx + tabW / 2, ty + th / 2] });
  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor('#0b0b0d', 0.9)
    .text(ticketNo, tx + tabW / 2 - 90, ty + th / 2 - 10, {
      width: 180,
      align: 'center',
      characterSpacing: 4,
    });
  doc.restore();

  // ---- bloque logo ----
  const logoX = tx + tabW + 26;
  drawFlags(doc, logoX + 92, ty + 42, color.hex);
  doc.font('Helvetica-Bold').fontSize(52).fillColor('#ffffff');
  doc.text('FLAGS', logoX, ty + 58, { width: 200, align: 'center', characterSpacing: 2 });

  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff', 0.92);
  doc.text('—  F E S T  —', logoX, ty + 116, { width: 200, align: 'center' });

  doc.font('Helvetica-Bold').fontSize(8);
  const subY = ty + 142;
  const subParts = [
    ['GREEN FLAGS', COLOR_INFO.verde.hex],
    [' & ', '#ffffff'],
    ['RED FLAGS', COLOR_INFO.rojo.hex],
    [' PARTY', '#ffffff'],
  ];
  const subWidths = subParts.map(([t]) => doc.widthOfString(t, { characterSpacing: 0.5 }));
  let subX = logoX + 100 - subWidths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < subParts.length; i += 1) {
    doc.fillColor(subParts[i][1]).text(subParts[i][0], subX, subY, {
      characterSpacing: 0.5,
      lineBreak: false,
    });
    subX += subWidths[i];
  }

  // fecha y lugar del evento bajo el logo
  doc.font('Helvetica').fontSize(8).fillColor('#ffffff', 0.75);
  const whenWhere = [formatDateOnly(ticket.event_date), ticket.event_location].filter(Boolean).join('  ·  ');
  doc.text(whenWhere, logoX, ty + 160, { width: 200, align: 'center', characterSpacing: 0.5 });

  // ---- bloque central: concepto del color ----
  const cX = tx + 320;
  const cW = 240;

  drawSparkle(doc, cX - 12, ty + 48, 5, color.soft, 0.8);
  drawSparkle(doc, cX + cW + 4, ty + 60, 4, color.soft, 0.6);
  drawSparkle(doc, cX - 6, ty + 168, 4, color.soft, 0.6);
  drawSparkle(doc, cX + cW + 10, ty + 150, 5, color.soft, 0.8);

  doc.font('Helvetica-Bold').fontSize(23).fillColor('#ffffff', 1);
  doc.text(color.label, cX, ty + 34, { width: cW, align: 'center', characterSpacing: 4 });

  doc.font('Helvetica-BoldOblique').fontSize(30).fillColor(color.hex, 1);
  const conceptW = doc.widthOfString(color.concept);
  doc.text(color.concept, cX, ty + 68, { width: cW, align: 'center' });
  drawHeart(doc, Math.min(cX + cW / 2 + conceptW / 2 + 24, cX + cW + 14), ty + 84, 12, color.hex);

  const underW = Math.min(doc.widthOfString(color.concept) + 16, cW);
  doc
    .lineWidth(2.4)
    .strokeColor(color.hex, 0.85)
    .moveTo(cX + (cW - underW) / 2, ty + 106)
    .lineTo(cX + (cW + underW) / 2, ty + 106)
    .stroke();

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#ffffff', 0.95);
  doc.text(color.description.toUpperCase(), cX + 20, ty + 124, {
    width: cW - 40,
    align: 'center',
    lineGap: 3,
  });

  doc.font('Helvetica').fontSize(8).fillColor(color.soft, 0.9);
  doc.text(`${CURRENCY} ${Number(ticket.price).toFixed(2)}  ·  ${ticket.phase_name || ''}`, cX, ty + 158, {
    width: cW,
    align: 'center',
    characterSpacing: 0.5,
  });

  doc.font('Helvetica').fontSize(7.5).fillColor(color.soft, 0.8);
  doc.text(TAGLINE.toUpperCase(), cX, ty + 176, {
    width: cW,
    align: 'center',
    characterSpacing: 1,
  });

  // ---- separador + texto vertical ----
  const sepX = tx + 580;
  doc
    .lineWidth(1)
    .strokeColor('#ffffff', 0.35)
    .moveTo(sepX, ty + 26)
    .lineTo(sepX, ty + th - 26)
    .dash(3, { space: 4 })
    .stroke()
    .undash();

  doc.save();
  doc.rotate(-90, { origin: [sepX + 16, ty + th / 2] });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#ffffff', 0.9)
    .text('ELIGE TU COLOR, VIVE LA NOCHE.', sepX + 16 - 100, ty + th / 2 - 5, {
      width: 200,
      align: 'center',
      characterSpacing: 1.5,
    });
  doc.restore();

  // ---- bloque QR (~40 mm, negro sobre blanco) ----
  const qrSize = 118;
  const qrX = tx + tw - qrSize - 50;
  const qrY = ty + 24;

  for (let i = 3; i >= 1; i -= 1) {
    doc
      .lineWidth(2)
      .strokeColor(color.hex, 0.5 / i)
      .roundedRect(qrX - 6 - i * 3, qrY - 6 - i * 3, qrSize + 12 + i * 6, qrSize + 12 + i * 6, 10 + i * 2)
      .stroke();
  }
  doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 10).fill('#ffffff');
  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

  doc.font('Helvetica-Bold').fontSize(15).fillColor(color.hex);
  doc.text(ticket.short_code, qrX - 26, qrY + qrSize + 16, {
    width: qrSize + 52,
    align: 'center',
    characterSpacing: 4,
  });
  doc.font('Helvetica').fontSize(6).fillColor('#ffffff', 0.65);
  doc.text('PRESENTAR ESTE CÓDIGO QR', qrX - 26, qrY + qrSize + 36, {
    width: qrSize + 52,
    align: 'center',
    characterSpacing: 0.4,
  });
  doc.text('EL DÍA DEL EVENTO', qrX - 26, qrY + qrSize + 45, {
    width: qrSize + 52,
    align: 'center',
    characterSpacing: 0.4,
  });

  doc.restore(); // fin clip del ticket

  // borde del ticket
  doc.lineWidth(1.2).strokeColor(color.hex, 0.55).roundedRect(tx, ty, tw, th, 16).stroke();

  // muescas laterales tipo boleto
  doc.circle(tx, ty + th / 2, 11).fill('#050508');
  doc.circle(tx + tw, ty + th / 2, 11).fill('#050508');
  doc.lineWidth(1.2).strokeColor(color.hex, 0.45);
  doc.circle(tx, ty + th / 2, 11).stroke();
  doc.circle(tx + tw, ty + th / 2, 11).stroke();

  // ---- banda inferior de datos ----
  const bandY = ty + th + gap;
  doc.roundedRect(tx, bandY, tw, bandH, 10).fill('#131316');
  doc.lineWidth(0.8).strokeColor('#ffffff', 0.12).roundedRect(tx, bandY, tw, bandH, 10).stroke();

  // Datos de identidad del cliente (si existen): línea pequeña extra
  // bajo el correo. Prioridad visual intacta: nombre, código, color, QR.
  const idBits = [
    ticket.customer_document ? `CI ${ticket.customer_document}` : null,
    ticket.customer_phone || null,
  ].filter(Boolean).join(' · ');

  const fields = [
    ['CLIENTE', ticket.customer_name, ticket.customer_email || '', idBits],
    ['COLOR', `${color.label} · ${color.concept}`, ''],
    ['FASE', ticket.phase_name || '-', `${CURRENCY} ${Number(ticket.price).toFixed(2)}`],
    ['EVENTO', formatDateOnly(ticket.event_date), ticket.event_location || ''],
    ['VENDEDOR', ticket.seller_name || '-', `Venta: ${formatEc(ticket.sold_at)}`],
  ];
  const colW = (tw - 220) / fields.length;
  fields.forEach(([label, value, extra, extra2], i) => {
    const fx = tx + 18 + i * colW;
    const maxW = colW - 14;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(color.soft, 0.85);
    doc.text(label, fx, bandY + 12, { characterSpacing: 1, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#ffffff', 1);
    doc.text(fitText(doc, value, maxW), fx, bandY + 25, { lineBreak: false });
    if (extra) {
      doc.font('Helvetica').fontSize(7).fillColor('#ffffff', 0.55);
      doc.text(fitText(doc, extra, maxW), fx, bandY + 39, { lineBreak: false });
    }
    if (extra2) {
      doc.font('Helvetica').fontSize(6.5).fillColor('#ffffff', 0.45);
      doc.text(fitText(doc, extra2, maxW), fx, bandY + 50, { lineBreak: false });
    }
  });

  // sello derecho: intransferible + branding del estudio
  const stampX = tx + tw - 200;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(color.hex, 0.95);
  doc.text('ENTRADA ÚNICA E INTRANSFERIBLE', stampX, bandY + 14, {
    width: 184,
    align: 'right',
    characterSpacing: 0.6,
  });
  doc.font('Helvetica').fontSize(6.5).fillColor('#ffffff', 0.45);
  doc.text('El QR solo podrá ser validado una vez', stampX, bandY + 27, {
    width: 184,
    align: 'right',
  });
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#ffffff', 0.35);
  doc.text('ASTRAVIA STUDIO', stampX, bandY + 42, {
    width: 184,
    align: 'right',
    characterSpacing: 2,
  });

  // ---- pie de página: logo + "Desarrollado por ASTRAVIA STUDIO" ----
  // Lockup centrado bajo el ticket (la franja inferior de la página
  // quedaba vacía). Branding secundario: discreto, sin competir con
  // FLAGS FEST ni acercarse al QR (que vive dentro del ticket).
  const logo = getAstraviaLogo();
  const footY = bandY + bandH + 26;
  doc.font('Helvetica').fontSize(6.5);
  const smallW = doc.widthOfString('DESARROLLADO POR', { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(10);
  const nameW = doc.widthOfString('ASTRAVIA STUDIO', { characterSpacing: 2.5 });
  const textBlockW = Math.max(smallW, nameW);

  if (logo) {
    const logoSize = 40; // cuadrado: se dibuja 1:1, sin deformar
    const gapL = 12;
    const startX = (PAGE_W - (logoSize + gapL + textBlockW)) / 2;
    doc.save();
    doc.roundedRect(startX, footY, logoSize, logoSize, 9).clip();
    doc.image(logo, startX, footY, { width: logoSize, height: logoSize });
    doc.restore();
    doc.lineWidth(0.8).strokeColor('#ffffff', 0.22).roundedRect(startX, footY, logoSize, logoSize, 9).stroke();

    const textX = startX + logoSize + gapL;
    doc.font('Helvetica').fontSize(6.5).fillColor('#ffffff', 0.45);
    doc.text('DESARROLLADO POR', textX, footY + 9, { characterSpacing: 1.5, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff', 0.8);
    doc.text('ASTRAVIA STUDIO', textX, footY + 20, { characterSpacing: 2.5, lineBreak: false });
  } else {
    // Sin logo disponible: el texto centrado ocupa el espacio igual.
    doc.font('Helvetica').fontSize(6.5).fillColor('#ffffff', 0.45);
    doc.text('DESARROLLADO POR', 0, footY + 9, { width: PAGE_W, align: 'center', characterSpacing: 1.5 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff', 0.8);
    doc.text('ASTRAVIA STUDIO', 0, footY + 20, { width: PAGE_W, align: 'center', characterSpacing: 2.5 });
  }

  doc.end();
  return done;
}

module.exports = { generateTicketPdf };
