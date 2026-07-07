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

module.exports = { storageDir, ticketPdfPath, saveTicketPdf, readTicketPdf };
