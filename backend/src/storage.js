const fs = require('fs');
const path = require('path');

// Los PDFs viven FUERA del webroot público; solo se sirven a través
// del endpoint autenticado GET /api/tickets/:id/pdf.
function storageDir() {
  return path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage'));
}

function ticketPdfPath(eventId, ticketId) {
  return path.join(storageDir(), 'tickets', String(eventId), `${ticketId}.pdf`);
}

async function saveTicketPdf(eventId, ticketId, buffer) {
  const file = ticketPdfPath(eventId, ticketId);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  return file;
}

async function readTicketPdf(filePath) {
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

// ---- comprobantes de pago de compras web ----
// Igual que los PDFs: viven FUERA del webroot y solo se sirven por el
// endpoint autenticado GET /api/purchases/:id/proof.
function proofPath(eventId, requestId, ext) {
  return path.join(storageDir(), 'proofs', String(eventId), `${requestId}.${ext}`);
}

async function saveProofFile(eventId, requestId, ext, buffer) {
  const file = proofPath(eventId, requestId, ext);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  return file;
}

// Imagen QR de pago (configuración del admin; SÍ es pública: se muestra
// en la página de compra vía GET /api/public/payment-qr).
function paymentQrPath(eventId, ext) {
  return path.join(storageDir(), 'payment', `${eventId}-qr.${ext}`);
}

async function savePaymentQr(eventId, ext, buffer) {
  const file = paymentQrPath(eventId, ext);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  return file;
}

// QR de pago POR MÉTODO (varios bancos por evento, cada uno con su QR)
function paymentMethodQrPath(eventId, methodId, ext) {
  return path.join(storageDir(), 'payment', `${eventId}-${methodId}.${ext}`);
}

async function savePaymentMethodQr(eventId, methodId, ext, buffer) {
  const file = paymentMethodQrPath(eventId, methodId, ext);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  return file;
}

// Lectura genérica de un archivo del storage (null si no existe)
async function readStoredFile(filePath) {
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

async function deleteStoredFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch { /* ya no existe */ }
}

module.exports = {
  storageDir, ticketPdfPath, saveTicketPdf, readTicketPdf,
  proofPath, saveProofFile, paymentQrPath, savePaymentQr,
  paymentMethodQrPath, savePaymentMethodQr, readStoredFile, deleteStoredFile,
};
