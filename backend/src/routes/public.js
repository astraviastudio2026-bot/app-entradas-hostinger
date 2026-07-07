// Rutas PÚBLICAS del flujo de compra web (sin login):
//   GET  /api/public/event            info del evento, fase, precio, datos de transferencia
//   GET  /api/public/payment-qr       imagen QR de pago configurada por el admin (si existe)
//   POST /api/public/purchase         crear solicitud de compra (multipart con comprobante)
//   POST /api/public/purchase-status  consultar estado (código + correo, ambos obligatorios)
//   POST /api/public/recover-code     enviar por correo los códigos de solicitudes recientes
//
// IMPORTANTE: enviar el formulario público JAMÁS genera entrada, QR ni
// PDF. Solo crea una solicitud "pending" que un admin/organizador debe
// aprobar desde el panel (POST /api/purchases/:id/approve).
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { ah, uuid, isValidEmail, COLORS } = require('../utils');
const { getActiveEvent, getCurrentPhase } = require('../queries');
const { saveProofFile, readStoredFile, deleteStoredFile } = require('../storage');
const { sendRequestReceivedEmail, sendCodeRecoveryEmail } = require('../webMailer');
const { audit } = require('../audit');

const router = express.Router();

// ------------------------------------------------------------
// Límites por IP (endpoints públicos)
// ------------------------------------------------------------
const purchaseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes desde esta conexión. Inténtalo de nuevo más tarde.' },
});
const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas. Espera unos minutos e inténtalo de nuevo.' },
});
const recoverLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de recuperación. Inténtalo de nuevo más tarde.' },
});

// ------------------------------------------------------------
// Comprobante: jpg / jpeg / png / webp / pdf, máx. 5 MB.
// Se valida extensión + MIME + firma binaria (magic bytes): un
// ejecutable renombrado a .jpg no pasa.
// ------------------------------------------------------------
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function sniffProofType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.slice(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1 },
});

// Envuelve multer para responder 422 legible en vez de error 500.
function uploadProof(req, res, next) {
  upload.single('payment_proof')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(422).json({ error: 'El comprobante supera el tamaño máximo de 5 MB.' });
      }
      return res.status(422).json({ error: 'No se pudo procesar el archivo del comprobante.' });
    }
    return next();
  });
}

// Configuración de pagos del evento (o null si no hay fila)
async function getPaymentSettings(eventId, db = pool) {
  const [rows] = await db.query('SELECT * FROM payment_settings WHERE event_id = ?', [eventId]);
  return rows[0] || null;
}

// Entradas ocupadas = vendidas o usadas (las anuladas liberan cupo).
// Las solicitudes web pendientes NO descuentan: solo la aprobación crea
// la entrada real.
async function soldCount(eventId, db = pool) {
  const [[{ sold }]] = await db.query(
    "SELECT COUNT(*) AS sold FROM tickets WHERE event_id = ? AND status IN ('sold','used')",
    [eventId]
  );
  return Number(sold) || 0;
}

// ------------------------------------------------------------
// GET /api/public/event — todo lo que la landing necesita
// ------------------------------------------------------------
router.get('/event', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.json({ event: null, sales_enabled: false });

  const [phase, settings, sold] = await Promise.all([
    getCurrentPhase(event.id),
    getPaymentSettings(event.id),
    soldCount(event.id),
  ]);
  const available = Math.max(0, event.total_tickets - sold);
  const salesEnabled = Boolean(settings && settings.public_sales_enabled);

  res.json({
    event: {
      name: event.name,
      event_date: event.event_date,
      location: event.location,
    },
    phase: phase ? { name: phase.name, price: phase.price, ends_at: phase.ends_at } : null,
    available,
    sold_out: available <= 0,
    sales_enabled: salesEnabled,
    payment: settings ? {
      bank_name: settings.bank_name,
      account_type: settings.account_type,
      account_number: settings.account_number,
      account_holder: settings.account_holder,
      account_document: settings.account_document,
      transfer_note: settings.transfer_note,
      buyer_message: settings.buyer_message,
      has_qr_image: Boolean(settings.qr_image_path),
    } : null,
    colors: COLORS,
  });
}));

// ------------------------------------------------------------
// GET /api/public/payment-qr — imagen QR de pago (pública: es la
// que el comprador escanea para transferir)
// ------------------------------------------------------------
router.get('/payment-qr', ah(async (req, res) => {
  const event = await getActiveEvent();
  if (!event) return res.status(404).json({ error: 'No disponible' });
  const settings = await getPaymentSettings(event.id);
  if (!settings || !settings.qr_image_path) return res.status(404).json({ error: 'No disponible' });
  const buffer = await readStoredFile(settings.qr_image_path);
  if (!buffer) return res.status(404).json({ error: 'No disponible' });
  res.setHeader('Content-Type', settings.qr_image_mime || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(buffer);
}));

// ------------------------------------------------------------
// POST /api/public/purchase — crear solicitud (estado "pending")
// ------------------------------------------------------------
const PHONE_RE = /^[+]?[\d\s()-]{7,20}$/;

router.post('/purchase', purchaseLimiter, uploadProof, ah(async (req, res) => {
  const body = req.body || {};
  const buyerName = String(body.buyer_name || '').trim().replace(/\s+/g, ' ');
  const buyerEmail = String(body.buyer_email || '').trim().toLowerCase();
  const buyerPhone = String(body.buyer_phone || '').trim();
  const buyerDocument = String(body.buyer_document || '').trim().slice(0, 30) || null;
  const color = String(body.selected_color || '');
  const notes = String(body.notes || '').trim().slice(0, 500) || null;

  // ---- validaciones del formulario ----
  if (buyerName.length < 3 || buyerName.length > 120) {
    return res.status(422).json({ error: 'Escribe tus nombres completos (entre 3 y 120 caracteres).' });
  }
  if (!isValidEmail(buyerEmail)) {
    return res.status(422).json({ error: 'El correo electrónico no es válido.' });
  }
  if (!PHONE_RE.test(buyerPhone)) {
    return res.status(422).json({ error: 'Escribe un teléfono o WhatsApp válido (7 a 20 dígitos).' });
  }
  if (!COLORS.includes(color)) {
    return res.status(422).json({ error: 'Selecciona el tipo de entrada (Green Flag, Red Flag o Yellow Flag).' });
  }
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(422).json({ error: 'Debes adjuntar la captura o comprobante de la transferencia.' });
  }
  const sniffed = sniffProofType(req.file.buffer);
  if (!sniffed || !PROOF_TYPES[sniffed]) {
    return res.status(422).json({ error: 'El comprobante debe ser una imagen JPG, PNG, WEBP o un PDF.' });
  }
  const ext = PROOF_TYPES[sniffed];
  const originalName = String(req.file.originalname || `comprobante.${ext}`).slice(0, 160);
  const proofHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

  // ---- contexto del evento ----
  const event = await getActiveEvent();
  if (!event) return res.status(409).json({ error: 'No hay un evento activo en este momento.' });
  const settings = await getPaymentSettings(event.id);
  if (!settings || !settings.public_sales_enabled) {
    return res.status(409).json({ error: 'La venta web no está habilitada en este momento.' });
  }
  const phase = await getCurrentPhase(event.id);
  if (!phase) {
    return res.status(409).json({ error: 'No hay una fase de venta activa en este momento.' });
  }

  const DUP_MESSAGE = 'Ya existe una solicitud registrada con estos datos o con este comprobante. '
    + 'Consulta el estado de tu solicitud con el código enviado a tu correo o comunícate con la organización. '
    + 'Si no encuentras tu código, usa la opción "Olvidé mi código".';

  // Pre-chequeo rápido de duplicados (la verificación definitiva se
  // repite dentro de la transacción, con el evento bloqueado).
  const [preDup] = await pool.query(
    `SELECT id FROM purchase_requests
     WHERE (payment_proof_hash = ? AND status IN ('pending','approved'))
        OR (buyer_email = ? AND event_id = ? AND selected_color = ? AND price = ? AND status = 'pending')
     LIMIT 1`,
    [proofHash, buyerEmail, event.id, color, phase.price]
  );
  if (preDup.length) return res.status(409).json({ error: DUP_MESSAGE, duplicate: true });

  // Disponibilidad (informativa: la definitiva se valida al aprobar)
  const sold = await soldCount(event.id);
  if (sold >= event.total_tickets) {
    return res.status(409).json({ error: 'Lo sentimos: ya se agotaron las entradas disponibles.' });
  }

  // ---- guardar comprobante y crear la solicitud ----
  const requestId = uuid();
  const proofPathSaved = await saveProofFile(event.id, requestId, ext, req.file.buffer);

  const conn = await pool.getConnection();
  let requestCode;
  try {
    await conn.beginTransaction();

    // El lock del evento serializa solicitudes concurrentes: el chequeo
    // de duplicados y el contador del código quedan protegidos.
    await conn.query('SELECT id FROM events WHERE id = ? FOR UPDATE', [event.id]);

    const [dup] = await conn.query(
      `SELECT id FROM purchase_requests
       WHERE (payment_proof_hash = ? AND status IN ('pending','approved'))
          OR (buyer_email = ? AND event_id = ? AND selected_color = ? AND price = ? AND status = 'pending')
       LIMIT 1`,
      [proofHash, buyerEmail, event.id, color, phase.price]
    );
    if (dup.length) {
      await conn.rollback();
      await deleteStoredFile(proofPathSaved);
      return res.status(409).json({ error: DUP_MESSAGE, duplicate: true });
    }

    await conn.query('UPDATE web_request_counter SET `last_value` = `last_value` + 1 WHERE id = 1');
    const [[{ lastValue }]] = await conn.query('SELECT `last_value` AS lastValue FROM web_request_counter WHERE id = 1');
    requestCode = `FF-WEB-${String(lastValue).padStart(6, '0')}`;

    await conn.query(
      `INSERT INTO purchase_requests
         (id, request_code, event_id, buyer_name, buyer_email, buyer_phone, buyer_document,
          selected_color, sale_phase_id, phase_name, price,
          payment_proof_path, payment_proof_filename, payment_proof_mime, payment_proof_hash,
          status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, UTC_TIMESTAMP())`,
      [requestId, requestCode, event.id, buyerName, buyerEmail, buyerPhone, buyerDocument,
        color, phase.id, phase.name, phase.price,
        proofPathSaved, originalName, sniffed, proofHash, notes]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    await deleteStoredFile(proofPathSaved);
    throw err;
  } finally {
    conn.release();
  }

  // Correo de confirmación (sin PDF, sin QR). Si falla, la solicitud
  // queda registrada igual y el comprador conserva el código en pantalla.
  const emailResult = await sendRequestReceivedEmail({
    request_code: requestCode,
    buyer_name: buyerName,
    buyer_email: buyerEmail,
    selected_color: color,
    price: phase.price,
    phase_name: phase.name,
  }, event.name);
  if (emailResult.ok) {
    await pool.query('UPDATE purchase_requests SET status_email_sent_at = UTC_TIMESTAMP() WHERE id = ?', [requestId]);
  }

  await audit(pool, {
    actorId: null,
    action: 'web_purchase.create',
    entityType: 'purchase_request',
    entityId: requestId,
    metadata: { request_code: requestCode, buyer_email: buyerEmail, color, price: phase.price },
  });

  res.status(201).json({
    ok: true,
    request_code: requestCode,
    email_sent: emailResult.ok,
    message: `Tu solicitud fue recibida correctamente. Tu código de seguimiento es: ${requestCode}. `
      + 'Guarda este código para consultar el estado de tu compra. '
      + 'Cuando validemos tu pago, recibirás tu entrada en el correo registrado.',
  });
}));

// ------------------------------------------------------------
// POST /api/public/purchase-status — código + correo obligatorios
// (nunca lista solicitudes, nunca muestra el comprobante ni datos
// internos; solo la solicitud que coincide con AMBOS datos)
// ------------------------------------------------------------
const STATUS_MESSAGES = {
  pending: 'Tu pago fue recibido y está pendiente de validación por la organización. '
    + 'Cuando sea aprobado, recibirás tu entrada en el correo registrado.',
  approved: 'Tu pago fue aprobado. Tu entrada fue enviada al correo registrado. '
    + 'Revisa también tu carpeta de spam o promociones.',
  rejected: 'Tu solicitud fue rechazada.',
};

router.post('/purchase-status', statusLimiter, ah(async (req, res) => {
  const code = String((req.body && req.body.request_code) || '').trim().toUpperCase();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^FF-WEB-\d{6}$/.test(code) || !isValidEmail(email)) {
    return res.status(422).json({ error: 'Ingresa tu código de solicitud (FF-WEB-000000) y el correo con el que compraste.' });
  }

  const [rows] = await pool.query(
    `SELECT r.request_code, r.buyer_name, r.selected_color, r.phase_name, r.price, r.status,
            r.rejection_reason, r.created_at, r.approved_at, r.rejected_at,
            e.name AS event_name, e.event_date, e.location
     FROM purchase_requests r
     JOIN events e ON e.id = r.event_id
     WHERE r.request_code = ? AND r.buyer_email = ?`,
    [code, email]
  );
  const request = rows[0];
  if (!request) {
    return res.status(404).json({ error: 'No encontramos ninguna solicitud con ese código y ese correo. Revisa ambos datos.' });
  }

  await pool.query(
    'UPDATE purchase_requests SET last_status_check_at = UTC_TIMESTAMP() WHERE request_code = ?',
    [code]
  );

  let message = STATUS_MESSAGES[request.status] || '';
  if (request.status === 'rejected') {
    message += ` Motivo: ${request.rejection_reason || 'no especificado'}. `
      + 'Comunícate con la organización si consideras que hubo un error.';
  }

  res.json({
    request: {
      request_code: request.request_code,
      buyer_name: request.buyer_name,
      event_name: request.event_name,
      event_date: request.event_date,
      selected_color: request.selected_color,
      phase_name: request.phase_name,
      price: request.price,
      status: request.status,
      rejection_reason: request.status === 'rejected' ? request.rejection_reason : null,
      created_at: request.created_at,
      resolved_at: request.approved_at || request.rejected_at || null,
      message,
    },
  });
}));

// ------------------------------------------------------------
// POST /api/public/recover-code — "Olvidé mi código".
// La información viaja SOLO al correo registrado; la respuesta HTTP
// es siempre genérica para no revelar si el correo existe.
// ------------------------------------------------------------
router.post('/recover-code', recoverLimiter, ah(async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(422).json({ error: 'Ingresa un correo electrónico válido.' });
  }

  const genericResponse = {
    ok: true,
    message: 'Si existen solicitudes registradas con ese correo, enviamos un resumen con tus códigos. Revisa tu bandeja de entrada y spam.',
  };

  const event = await getActiveEvent();
  if (!event) return res.json(genericResponse);

  const [requests] = await pool.query(
    `SELECT request_code, status, selected_color, created_at
     FROM purchase_requests
     WHERE buyer_email = ? AND event_id = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    [email, event.id]
  );
  if (requests.length) {
    await sendCodeRecoveryEmail(email, requests, event.name);
  }
  res.json(genericResponse);
}));

module.exports = router;
