import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadPdf } from '../api';
import { useAuth } from '../App.jsx';
import { TICKET_COLORS, fmtMoney, useToast } from '../components.jsx';

export default function SellTicket() {
  const { user, currency } = useAuth();
  const toast = useToast();
  const [phase, setPhase] = useState(null);
  const [phaseLoaded, setPhaseLoaded] = useState(false);
  const [dash, setDash] = useState(null);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [color, setColor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sold, setSold] = useState(null); // resultado de la venta

  const loadContext = () => {
    api('/phases/current').then((d) => { setPhase(d.phase); setPhaseLoaded(true); });
    api('/dashboard').then(setDash).catch(() => {});
  };
  useEffect(loadContext, []);

  const remaining = dash
    ? (dash.role === 'admin' ? dash.global_available : Math.min(dash.my_remaining, dash.global_available))
    : null;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!color) {
      setError('Selecciona el color elegido por el cliente');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/tickets/sell', {
        method: 'POST',
        body: { buyer_name: buyerName, buyer_email: buyerEmail, selected_color: color },
      });
      setSold(data);
      if (data.email_sent) toast(`Entrada enviada a ${data.ticket.buyer_email}`, 'success');
      else if (data.warning) toast(data.warning, 'warning');
      setBuyerName('');
      setBuyerEmail('');
      setColor('');
      loadContext();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (sold) {
    const t = sold.ticket;
    const c = TICKET_COLORS[t.selected_color];
    return (
      <div className="page">
        <div className="sold-card panel" style={{ '--sold-color': c.hex }}>
          <div className="sold-check">✓</div>
          <h2>¡Entrada vendida!</h2>
          <div className="sold-code">{t.code}</div>
          <div className="sold-meta">
            <span>{t.buyer_name}</span>
            <span>{t.buyer_email}</span>
            <span style={{ color: c.hex, fontWeight: 700 }}>{c.label} · {c.concept}</span>
            <span>{fmtMoney(t.price, currency)} · {t.phase_name}</span>
          </div>
          {sold.warning ? <div className="form-warning">{sold.warning}</div> : (
            sold.email_sent ? <div className="form-success">Correo enviado al cliente ✓</div> : null
          )}
          <div className="sold-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => downloadPdf(t.id, t.code).catch((err) => toast(err.message, 'error'))}
            >
              Descargar PDF
            </button>
            <Link to={`/entradas/${t.id}`} className="btn btn-ghost">Ver detalle</Link>
            <button type="button" className="btn btn-ghost" onClick={() => setSold(null)}>
              Vender otra
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vender entrada</h1>
          <p className="page-sub">
            {phase
              ? <>Fase vigente: <strong>{phase.name}</strong> · {fmtMoney(phase.price, currency)}</>
              : (phaseLoaded ? '⚠ No hay fase de venta vigente' : 'Cargando fase…')}
            {remaining !== null ? <> · Te quedan <strong>{remaining}</strong> entradas</> : null}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="sell-form panel">
        <div className="form-row">
          <label className="field">
            <span>Nombre del cliente *</span>
            <input
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Nombre y apellido"
              maxLength={150}
              required
            />
          </label>
          <label className="field">
            <span>Correo del cliente *</span>
            <input
              type="email"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
              placeholder="cliente@correo.com"
              maxLength={190}
              required
            />
          </label>
        </div>

        <span className="field-label">Color elegido por el cliente *</span>
        <div className="color-picker">
          {Object.values(TICKET_COLORS).map((c) => (
            <button
              key={c.key}
              type="button"
              className={`color-option${color === c.key ? ' selected' : ''}`}
              style={{ '--opt-color': c.hex }}
              onClick={() => setColor(c.key)}
            >
              <span className="opt-dot" />
              <span className="opt-label">{c.label}</span>
              <span className="opt-concept">{c.concept}</span>
              <span className="opt-desc">{c.description}</span>
            </button>
          ))}
        </div>
        <p className="color-tagline">“Elige tu color, vive la noche”</p>

        {error ? <div className="form-error">{error}</div> : null}

        <button
          type="submit"
          className="btn btn-primary btn-lg btn-block"
          disabled={busy || !phase || (remaining !== null && remaining <= 0)}
        >
          {busy ? 'Registrando…' : remaining === 0 ? 'Sin cupo disponible' : 'Registrar venta y enviar entrada'}
        </button>
        <p className="form-note">
          Al registrar la venta se genera el QR único y se envía el PDF al correo del cliente automáticamente.
        </p>
      </form>
    </div>
  );
}
