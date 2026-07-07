import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadPdf } from '../api';
import { useAuth } from '../App.jsx';
import {
  ColorBadge, StatusBadge, TICKET_COLORS, fmtDate, fmtMoney, useToast,
} from '../components.jsx';

// Página de venta (inicio del vendedor): cupo, fase vigente y precio,
// formulario de venta y sus últimas entradas con PDF / reenviar.
export default function Sell() {
  const { user } = useAuth();
  const toast = useToast();
  const [ctx, setCtx] = useState(null); // /api/dashboard
  const [ctxLoaded, setCtxLoaded] = useState(false);
  const [recent, setRecent] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [color, setColor] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyRow, setBusyRow] = useState('');
  const [error, setError] = useState('');
  const [sold, setSold] = useState(null); // resultado de la venta

  const loadContext = () => {
    api('/dashboard').then((d) => { setCtx(d); setCtxLoaded(true); }).catch(() => setCtxLoaded(true));
    api('/tickets').then((d) => setRecent(d.tickets.slice(0, 10))).catch(() => {});
  };
  useEffect(loadContext, []);

  const isSeller = user.role === 'seller';
  const phase = ctx?.phase || null;
  const noEvent = ctxLoaded && (!ctx || !ctx.event);
  const remaining = ctx
    ? (isSeller ? Math.min(ctx.my_remaining ?? 0, ctx.global_available) : ctx.global_available)
    : null;
  const noAllocation = isSeller && ctx && ctx.quota === null;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!color) {
      setError('Selecciona el color elegido por el cliente');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/tickets', {
        method: 'POST',
        body: {
          customer_name: customerName,
          customer_email: customerEmail,
          selected_color: color,
          notes: notes.trim() || undefined,
        },
      });
      setSold(data);
      if (data.emailSent) toast(`Entrada enviada a ${data.ticket.customer_email}`, 'success');
      else toast(data.message, 'warning');
      setCustomerName('');
      setCustomerEmail('');
      setColor('');
      setNotes('');
      loadContext();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (t) => {
    setBusyRow(t.id);
    try {
      const d = await api(`/tickets/${t.id}/resend`, { method: 'POST' });
      toast(d.message, 'success');
      loadContext();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyRow('');
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
          <div className="sold-code">{t.short_code}</div>
          <div className="sold-meta">
            <span>{t.customer_name}</span>
            <span>{t.customer_email}</span>
            <span style={{ color: c.hex, fontWeight: 700 }}>{c.label} · {c.concept}</span>
            <span>{fmtMoney(t.price)} · {t.phase_name}</span>
          </div>
          {sold.emailSent
            ? <div className="form-success">Correo enviado al cliente ✓</div>
            : <div className="form-warning">{sold.message}</div>}
          <div className="sold-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => downloadPdf(t.id, t.short_code).catch((err) => toast(err.message, 'error'))}
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

  const sellDisabled = busy || !phase || noEvent || noAllocation || (remaining !== null && remaining <= 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vender entrada</h1>
          <p className="page-sub">
            {noEvent ? '⚠ No hay evento activo configurado'
              : phase
                ? <>Fase vigente: <strong>{phase.name}</strong> · {fmtMoney(phase.price)}</>
                : (ctxLoaded ? '⚠ No hay una fase de venta activa para la fecha actual' : 'Cargando fase…')}
            {isSeller && ctx && !noAllocation
              ? <> · Cupo: <strong>{ctx.my_sold} de {ctx.quota}</strong> vendidas</>
              : null}
            {!isSeller && ctx ? <> · Disponibles: <strong>{ctx.global_available}</strong></> : null}
          </p>
        </div>
      </div>

      {noAllocation ? (
        <div className="panel form-warning" style={{ marginBottom: 16 }}>
          No tienes un cupo de entradas asignado para este evento. Pídele al administrador que te asigne uno.
        </div>
      ) : null}

      <form onSubmit={submit} className="sell-form panel">
        <div className="form-row">
          <label className="field">
            <span>Nombre del cliente *</span>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nombre y apellido"
              minLength={3}
              maxLength={120}
              required
            />
          </label>
          <label className="field">
            <span>Correo del cliente *</span>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="cliente@correo.com"
              maxLength={160}
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

        <label className="field">
          <span>Observación (opcional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej. pagó por transferencia"
            maxLength={500}
          />
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={sellDisabled}>
          {busy ? 'Registrando…'
            : remaining !== null && remaining <= 0 ? 'Sin cupo disponible'
              : 'Registrar venta y enviar entrada'}
        </button>
        <p className="form-note">
          Al registrar la venta se genera el QR único y se envía el PDF al correo del cliente automáticamente.
        </p>
      </form>

      <div className="panel">
        <div className="panel-head">
          <h3>{isSeller ? 'Tus últimas entradas' : 'Últimas entradas'}</h3>
          <Link to="/entradas" className="link">Ver todas →</Link>
        </div>
        {!recent.length ? <p className="cell-sub">Aún no hay ventas registradas</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th><th>Cliente</th><th>Color</th><th>Estado</th><th>Fecha</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Código">
                      <Link to={`/entradas/${t.id}`} className="code-link">{t.short_code}</Link>
                    </td>
                    <td data-label="Cliente">
                      <div className="cell-main">{t.customer_name}</div>
                      <div className="cell-sub">{t.customer_email}</div>
                    </td>
                    <td data-label="Color"><ColorBadge color={t.selected_color} /></td>
                    <td data-label="Estado"><StatusBadge status={t.status} /></td>
                    <td data-label="Fecha">{fmtDate(t.sold_at)}</td>
                    <td data-label="Acciones">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => downloadPdf(t.id, t.short_code).catch((err) => toast(err.message, 'error'))}
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={busyRow === t.id || t.status === 'cancelled'}
                          onClick={() => resend(t)}
                        >
                          {busyRow === t.id ? 'Enviando…' : 'Reenviar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
