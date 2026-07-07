import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiForm } from '../api';
import { TICKET_COLORS, fmtDateOnly, fmtMoney } from '../components.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[\d\s()-]{7,20}$/;
const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const PROOF_EXT_RE = /\.(jpe?g|png|webp|pdf)$/i;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

// Etiquetas públicas de los tipos de entrada (los colores internos
// verde/rojo/amarillo del sistema son los mismos que valida el backend)
const FLAG_LABELS = { verde: 'GREEN FLAG', rojo: 'RED FLAG', amarillo: 'YELLOW FLAG' };

function CopyButton({ value, label = 'Copiar' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* navegador sin clipboard */ }
  };
  return (
    <button type="button" className="pub-copy" onClick={copy}>
      {copied ? '✓ Copiado' : label}
    </button>
  );
}

export default function Comprar() {
  const [info, setInfo] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // formulario
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [color, setColor] = useState('');
  const [payMethodId, setPayMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(null); // { request_code, email_sent, message }
  const formRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    document.title = 'FLAGS FEST · Comprar entrada';
    api('/public/event')
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoaded(true));
  }, []);

  const event = info?.event || null;
  const phase = info?.phase || null;
  const payment = info?.payment || null;
  const payMethods = payment?.methods || [];
  const salesOpen = Boolean(info?.sales_enabled && phase && !info?.sold_out);

  // Si solo hay un banco, queda preseleccionado.
  useEffect(() => {
    if (payMethods.length === 1) setPayMethodId(payMethods[0].id);
  }, [payMethods.length]);

  const eventDateText = useMemo(() => (event ? fmtDateOnly(event.event_date) : ''), [event]);

  const onFileChange = (e) => {
    setError('');
    const f = e.target.files && e.target.files[0];
    if (!f) { setFile(null); setFilePreview(''); return; }
    if (!PROOF_TYPES.includes(f.type) && !PROOF_EXT_RE.test(f.name)) {
      setError('El comprobante debe ser una imagen JPG, PNG, WEBP o un PDF.');
      e.target.value = '';
      return;
    }
    if (f.size > MAX_PROOF_BYTES) {
      setError('El comprobante supera el tamaño máximo de 5 MB.');
      e.target.value = '';
      return;
    }
    setFile(f);
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      setFilePreview(url);
    } else {
      setFilePreview('');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    const cleanName = name.trim();
    if (cleanName.length < 3) return setError('Escribe tus nombres completos (mínimo 3 caracteres).');
    if (!EMAIL_RE.test(email.trim())) return setError('El correo electrónico no es válido.');
    if (!PHONE_RE.test(phone.trim())) return setError('Escribe un teléfono o WhatsApp válido.');
    if (!color) return setError('Selecciona tu tipo de entrada.');
    if (!payMethodId) return setError('Selecciona el banco al que hiciste tu transferencia.');
    if (!file) return setError('Adjunta la captura o comprobante de tu transferencia.');

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('buyer_name', cleanName);
      fd.append('buyer_email', email.trim());
      fd.append('buyer_phone', phone.trim());
      if (documentId.trim()) fd.append('buyer_document', documentId.trim());
      fd.append('selected_color', color);
      fd.append('payment_method_id', payMethodId);
      if (notes.trim()) fd.append('notes', notes.trim());
      fd.append('payment_proof', file);
      const data = await apiForm('/public/purchase', fd);
      setSuccess(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // ---------- pantalla de éxito ----------
  if (success) {
    return (
      <div className="pub-screen">
        <div className="pub-container pub-success-wrap">
          <div className="pub-card pub-success">
            <div className="pub-success-check">✓</div>
            <h2 className="pub-success-title">¡SOLICITUD RECIBIDA!</h2>
            <p className="pub-muted">
              Guarda este código: lo necesitas para consultar el estado de tu compra.
            </p>
            <div className="pub-code-box">
              <span className="pub-code-label">TU CÓDIGO DE SEGUIMIENTO</span>
              <span className="pub-code">{success.request_code}</span>
              <CopyButton value={success.request_code} label="Copiar código" />
            </div>
            <p className="pub-muted">
              {success.email_sent
                ? 'También te enviamos el código por correo (revisa spam/promociones).'
                : 'No pudimos enviarte el correo de confirmación: anota o copia tu código ahora.'}
            </p>
            <div className="pub-note-box">
              Tu pago será revisado por la organización. Cuando sea <strong>aprobado</strong>,
              recibirás tu <strong>entrada con QR en PDF</strong> en el correo registrado.
              Este mensaje aún no es tu entrada.
            </div>
            <div className="pub-success-actions">
              <Link to="/estado-compra" className="pub-btn pub-btn-primary">CONSULTAR ESTADO</Link>
              <button
                type="button"
                className="pub-btn pub-btn-ghost"
                onClick={() => {
                  setSuccess(null);
                  setName(''); setEmail(''); setPhone(''); setDocumentId('');
                  setColor(''); setPayMethodId(''); setNotes(''); setFile(null); setFilePreview('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Enviar otra solicitud
              </button>
            </div>
          </div>
          <PubFooter />
        </div>
      </div>
    );
  }

  return (
    <div className="pub-screen">
      {/* ---------- HERO ---------- */}
      <header className="pub-hero">
        <div className="pub-hero-bg" aria-hidden="true" />
        <div className="pub-hero-overlay" aria-hidden="true" />
        <div className="pub-container pub-hero-inner">
          {eventDateText ? <div className="pub-hero-date">{eventDateText.replace(/\//g, ' · ')}</div> : null}
          <h1 className="pub-hero-logo">
            FLAGS
            <span className="pub-hero-fest">— F E S T —</span>
          </h1>
          <div className="pub-hero-tags">RAVE <span className="pub-x">×</span> REGUETON</div>
          {event?.location ? <div className="pub-hero-place">📍 {event.location.toUpperCase()}</div> : null}
          <div className="pub-hero-actions">
            <button type="button" className="pub-btn pub-btn-primary pub-btn-lg" onClick={scrollToForm}>
              COMPRAR ENTRADA
            </button>
            <Link to="/estado-compra" className="pub-btn pub-btn-ghost pub-btn-lg">
              CONSULTAR ESTADO
            </Link>
          </div>
        </div>
      </header>

      <main className="pub-container pub-main">
        {!loaded ? (
          <div className="pub-card pub-center-text"><span className="pub-muted">Cargando…</span></div>
        ) : !event ? (
          <div className="pub-card pub-center-text">
            <span className="pub-muted">No hay un evento activo en este momento. Vuelve pronto.</span>
          </div>
        ) : (
          <>
            {/* ---------- FASE / PRECIO / DISPONIBILIDAD ---------- */}
            <section className="pub-section">
              <h2 className="pub-section-title">TU ENTRADA</h2>
              <div className="pub-info-grid">
                <div className="pub-card pub-info-card">
                  <span className="pub-info-label">FASE ACTUAL</span>
                  <span className="pub-info-value">{phase ? phase.name : 'Sin fase activa'}</span>
                  {!phase ? <span className="pub-muted-sm">La venta se abrirá según el calendario del evento.</span> : null}
                </div>
                <div className="pub-card pub-info-card pub-info-price">
                  <span className="pub-info-label">PRECIO</span>
                  <span className="pub-info-value pub-price">{phase ? fmtMoney(phase.price) : '—'}</span>
                </div>
                {/* Nunca mostrar cantidades exactas al público: solo mensaje general */}
                <div className="pub-card pub-info-card">
                  <span className="pub-info-label">CUPOS</span>
                  <span className={`pub-info-value${info.sold_out ? ' pub-soldout-value' : ''}`}>
                    {info.sold_out ? 'AGOTADO' : 'CUPOS LIMITADOS'}
                  </span>
                  {!info.sold_out ? (
                    <span className="pub-muted-sm">Sujeto a disponibilidad y validación de pago</span>
                  ) : null}
                </div>
              </div>
              <p className="pub-flow-note">
                Compra por <strong>transferencia bancaria</strong>: envía tu comprobante y, cuando la
                organización <strong>valide tu pago</strong>, recibirás tu entrada con QR único en tu correo.
              </p>
            </section>

            {/* ---------- MÉTODOS DE PAGO / DATOS DE TRANSFERENCIA ---------- */}
            {salesOpen && payMethods.length ? (
              <section className="pub-section">
                <h2 className="pub-section-title">DATOS PARA TU TRANSFERENCIA</h2>
                {payment.buyer_message ? (
                  <p className="pub-bank-msg" style={{ marginBottom: 16 }}>{payment.buyer_message}</p>
                ) : null}
                <div className="pub-methods-grid">
                  {payMethods.map((m) => {
                    const fullData = [
                      `Banco: ${m.bank_name}`,
                      m.account_type ? `Tipo de cuenta: ${m.account_type}` : null,
                      `Nº de cuenta: ${m.account_number}`,
                      `Titular: ${m.account_holder}`,
                      m.account_document ? `Cédula/RUC: ${m.account_document}` : null,
                    ].filter(Boolean).join('\n');
                    return (
                      <div key={m.id} className="pub-card pub-bank pub-method-card">
                        <div className="pub-method-head">
                          <span className="pub-method-bank">{m.bank_name}</span>
                          {m.account_type ? <span className="pub-method-type">{m.account_type}</span> : null}
                        </div>
                        <div className="pub-bank-rows">
                          <div className="pub-bank-row">
                            <span>Nº de cuenta</span>
                            <strong className="pub-account">{m.account_number}</strong>
                            <CopyButton value={m.account_number} />
                          </div>
                          <div className="pub-bank-row"><span>Titular</span><strong>{m.account_holder}</strong></div>
                          {m.account_document ? (
                            <div className="pub-bank-row"><span>Cédula / RUC</span><strong>{m.account_document}</strong></div>
                          ) : null}
                        </div>
                        {m.transfer_note ? <p className="pub-bank-note">⚠ {m.transfer_note}</p> : null}
                        {m.has_qr_image ? (
                          <div className="pub-bank-qr">
                            <img src={`/api/public/payment-qr/${m.id}`} alt={`QR de pago ${m.bank_name}`} loading="lazy" />
                            <span className="pub-muted-sm">Escanea para pagar en {m.bank_name}</span>
                          </div>
                        ) : null}
                        <CopyButton value={fullData} label="Copiar todos los datos" />
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {/* ---------- FORMULARIO ---------- */}
            <section className="pub-section" ref={formRef}>
              <h2 className="pub-section-title">RESERVA TU ENTRADA</h2>
              {!info.sales_enabled ? (
                <div className="pub-card pub-center-text">
                  <span className="pub-muted">
                    La venta web no está habilitada en este momento. Sigue nuestras redes para enterarte
                    cuando se active.
                  </span>
                </div>
              ) : info.sold_out ? (
                <div className="pub-card pub-center-text">
                  <span className="pub-soldout">ENTRADAS AGOTADAS</span>
                </div>
              ) : !phase ? (
                <div className="pub-card pub-center-text">
                  <span className="pub-muted">No hay una fase de venta activa hoy. Vuelve pronto.</span>
                </div>
              ) : (
                <form className="pub-card pub-form" onSubmit={submit}>
                  <div className="pub-form-grid">
                    <label className="pub-field">
                      <span>Nombres completos *</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nombre y apellido"
                        maxLength={120}
                        required
                      />
                    </label>
                    <label className="pub-field">
                      <span>Correo electrónico *</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tucorreo@ejemplo.com"
                        maxLength={160}
                        required
                      />
                    </label>
                    <label className="pub-field">
                      <span>Teléfono / WhatsApp *</span>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="09xxxxxxxx"
                        maxLength={20}
                        required
                      />
                    </label>
                    <label className="pub-field">
                      <span>Cédula o documento (opcional)</span>
                      <input
                        value={documentId}
                        onChange={(e) => setDocumentId(e.target.value)}
                        placeholder="Opcional"
                        maxLength={30}
                      />
                    </label>
                  </div>

                  <span className="pub-field-label">Tipo de entrada *</span>
                  <div className="pub-flags">
                    {Object.values(TICKET_COLORS).map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={`pub-flag${color === c.key ? ' selected' : ''}`}
                        style={{ '--flag': c.hex }}
                        onClick={() => setColor(c.key)}
                      >
                        <span className="pub-flag-dot" />
                        <span className="pub-flag-name">{FLAG_LABELS[c.key]}</span>
                        <span className="pub-flag-concept">{c.concept}</span>
                        <span className="pub-flag-desc">{c.description}</span>
                      </button>
                    ))}
                  </div>

                  <span className="pub-field-label">¿A qué banco hiciste tu transferencia? *</span>
                  <div className="pub-pay-picker">
                    {payMethods.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`pub-pay-option${payMethodId === m.id ? ' selected' : ''}`}
                        onClick={() => setPayMethodId(m.id)}
                      >
                        <span className="pub-pay-bank">{m.bank_name}</span>
                        <span className="pub-pay-sub">
                          {[m.account_type, m.account_number].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    ))}
                  </div>

                  <label className="pub-field">
                    <span>Observación (opcional)</span>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Algo que debamos saber"
                      maxLength={500}
                    />
                  </label>

                  <label className="pub-field">
                    <span>Captura o comprobante de la transferencia *</span>
                    <div className={`pub-file${file ? ' has-file' : ''}`}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                        onChange={onFileChange}
                        required
                      />
                      {filePreview ? (
                        <img src={filePreview} alt="Vista previa del comprobante" className="pub-file-preview" />
                      ) : (
                        <div className="pub-file-hint">
                          <span className="pub-file-icon">⬆</span>
                          {file ? file.name : 'Toca para subir tu comprobante'}
                          <span className="pub-muted-sm">JPG, PNG, WEBP o PDF · máx. 5 MB</span>
                        </div>
                      )}
                    </div>
                  </label>

                  {error ? <div className="pub-error">{error}</div> : null}

                  <button type="submit" className="pub-btn pub-btn-primary pub-btn-lg pub-btn-block" disabled={busy}>
                    {busy ? 'ENVIANDO SOLICITUD…' : 'ENVIAR SOLICITUD DE COMPRA'}
                  </button>
                  <p className="pub-form-note">
                    Al enviar, tu solicitud queda <strong>pendiente de validación manual</strong>.
                    La entrada con QR se genera y se envía a tu correo únicamente cuando la
                    organización apruebe tu pago.
                  </p>
                </form>
              )}
            </section>
          </>
        )}
        <PubFooter />
      </main>
    </div>
  );
}

function PubFooter() {
  return (
    <footer className="pub-footer">
      <span className="pub-footer-brand">| FLAGS |</span>
      <Link to="/estado-compra" className="pub-footer-link">Consultar estado de mi compra</Link>
      <div className="pub-studio">
        <img src="/astravia-logo.jpg" alt="ASTRAVIA STUDIO" loading="lazy" />
        <span>Desarrollado por <strong>ASTRAVIA STUDIO</strong></span>
      </div>
    </footer>
  );
}
