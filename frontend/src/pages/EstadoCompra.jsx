import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { TICKET_COLORS, fmtDate, fmtMoney } from '../components.jsx';

const FLAG_LABELS = { verde: 'GREEN FLAG', rojo: 'RED FLAG', amarillo: 'YELLOW FLAG' };

const STATUS_UI = {
  pending: { label: 'PENDIENTE', className: 'pub-status-pending', icon: '⏳' },
  approved: { label: 'APROBADA', className: 'pub-status-approved', icon: '✓' },
  rejected: { label: 'RECHAZADA', className: 'pub-status-rejected', icon: '✕' },
};

// Página PÚBLICA de seguimiento: exige código + correo (nunca lista
// solicitudes ni muestra datos sensibles/comprobantes).
export default function EstadoCompra() {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // "Olvidé mi código"
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverMsg, setRecoverMsg] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);

  useEffect(() => {
    document.title = 'FLAGS FEST · Estado de mi compra';
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const data = await api('/public/purchase-status', {
        method: 'POST',
        body: { request_code: code.trim().toUpperCase(), email: email.trim() },
      });
      setResult(data.request);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const recover = async (e) => {
    e.preventDefault();
    if (recoverBusy) return;
    setRecoverMsg('');
    setRecoverBusy(true);
    try {
      const data = await api('/public/recover-code', {
        method: 'POST',
        body: { email: recoverEmail.trim() },
      });
      setRecoverMsg(data.message);
    } catch (err) {
      setRecoverMsg(err.message);
    } finally {
      setRecoverBusy(false);
    }
  };

  const st = result ? STATUS_UI[result.status] || STATUS_UI.pending : null;
  const flagColor = result ? TICKET_COLORS[result.selected_color] : null;

  return (
    <div className="pub-screen pub-status-screen">
      <div className="pub-status-glow" aria-hidden="true" />
      <div className="pub-container pub-status-container">
        <Link to="/comprar" className="pub-status-logo">
          FLAGS<span>— F E S T —</span>
        </Link>

        <div className="pub-card pub-status-card">
          <h1 className="pub-section-title pub-center-text">ESTADO DE MI COMPRA</h1>

          {!recoverMode ? (
            <>
              <p className="pub-muted pub-center-text">
                Ingresa tu código de seguimiento y el correo con el que hiciste la compra.
              </p>
              <form onSubmit={submit} className="pub-status-form">
                <label className="pub-field">
                  <span>Código de solicitud *</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="FF-WEB-000001"
                    maxLength={20}
                    autoCapitalize="characters"
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
                {error ? <div className="pub-error">{error}</div> : null}
                <button type="submit" className="pub-btn pub-btn-primary pub-btn-block" disabled={busy}>
                  {busy ? 'CONSULTANDO…' : 'CONSULTAR ESTADO'}
                </button>
              </form>
              <button
                type="button"
                className="pub-link-btn"
                onClick={() => { setRecoverMode(true); setError(''); setResult(null); }}
              >
                Olvidé mi código
              </button>
            </>
          ) : (
            <>
              <p className="pub-muted pub-center-text">
                Escribe tu correo y te enviaremos un resumen de tus solicitudes recientes
                con sus códigos. Por seguridad, la información solo viaja a tu correo.
              </p>
              <form onSubmit={recover} className="pub-status-form">
                <label className="pub-field">
                  <span>Correo electrónico *</span>
                  <input
                    type="email"
                    value={recoverEmail}
                    onChange={(e) => setRecoverEmail(e.target.value)}
                    placeholder="tucorreo@ejemplo.com"
                    maxLength={160}
                    required
                  />
                </label>
                {recoverMsg ? <div className="pub-note-box">{recoverMsg}</div> : null}
                <button type="submit" className="pub-btn pub-btn-primary pub-btn-block" disabled={recoverBusy}>
                  {recoverBusy ? 'ENVIANDO…' : 'ENVIARME MIS CÓDIGOS'}
                </button>
              </form>
              <button
                type="button"
                className="pub-link-btn"
                onClick={() => { setRecoverMode(false); setRecoverMsg(''); }}
              >
                ← Volver a consultar estado
              </button>
            </>
          )}
        </div>

        {result && st ? (
          <div className={`pub-card pub-status-result ${st.className}`}>
            <div className="pub-status-icon">{st.icon}</div>
            <div className="pub-status-label">{st.label}</div>
            <p className="pub-status-message">{result.message}</p>
            <div className="pub-bank-rows">
              <div className="pub-bank-row"><span>Código</span><strong>{result.request_code}</strong></div>
              <div className="pub-bank-row"><span>Evento</span><strong>{result.event_name}</strong></div>
              <div className="pub-bank-row"><span>Fecha de solicitud</span><strong>{fmtDate(result.created_at)}</strong></div>
              <div className="pub-bank-row">
                <span>Tipo de entrada</span>
                <strong style={flagColor ? { color: flagColor.hex } : undefined}>
                  {FLAG_LABELS[result.selected_color] || result.selected_color}
                </strong>
              </div>
              <div className="pub-bank-row"><span>Precio</span><strong>{fmtMoney(result.price)}</strong></div>
              {result.phase_name ? (
                <div className="pub-bank-row"><span>Fase</span><strong>{result.phase_name}</strong></div>
              ) : null}
              {result.resolved_at ? (
                <div className="pub-bank-row">
                  <span>{result.status === 'approved' ? 'Aprobada el' : 'Resuelta el'}</span>
                  <strong>{fmtDate(result.resolved_at)}</strong>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="pub-status-actions">
          <Link to="/comprar" className="pub-btn pub-btn-ghost">← Volver a comprar</Link>
        </div>

        <footer className="pub-footer">
          <span className="pub-footer-studio">FLAGS FEST · ASTRAVIA STUDIO</span>
        </footer>
      </div>
    </div>
  );
}
