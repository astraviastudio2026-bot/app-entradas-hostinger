import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadPdf } from '../api';
import { useAuth } from '../App.jsx';
import {
  ColorBadge, StatusBadge, TICKET_COLORS, fmtDate, fmtDateOnly, fmtMoney, useToast,
} from '../components.jsx';
import TicketPreview from '../components/TicketPreview.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[\d\s()-]{7,20}$/;

// Página de venta (inicio del vendedor): formulario a la izquierda y
// vista previa de la entrada en tiempo real a la derecha (una columna
// en móvil). Mantiene cupo, fase, precio y últimas ventas.
export default function Sell() {
  const { user } = useAuth();
  const toast = useToast();
  const [ctx, setCtx] = useState(null); // /api/dashboard
  const [ctxLoaded, setCtxLoaded] = useState(false);
  const [recent, setRecent] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerDocument, setCustomerDocument] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
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
  const event = ctx?.event || null;
  const noEvent = ctxLoaded && (!ctx || !ctx.event);
  const remaining = ctx
    ? (isSeller ? Math.min(ctx.my_remaining ?? 0, ctx.global_available) : ctx.global_available)
    : null;
  const noAllocation = isSeller && ctx && ctx.quota === null;

  const eventDateText = event ? fmtDateOnly(event.event_date) : '';

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return; // evita doble clic / venta duplicada
    setError('');

    const name = customerName.trim();
    if (name.length < 3) {
      setError('Escribe el nombre completo del cliente (mínimo 3 caracteres).');
      return;
    }
    if (!EMAIL_RE.test(customerEmail.trim())) {
      setError('El correo del cliente no es válido. Revisa que tenga el formato nombre@dominio.com.');
      return;
    }
    if (customerDocument.trim().length < 5) {
      setError('Escribe la cédula o documento del cliente (mínimo 5 caracteres).');
      return;
    }
    if (!PHONE_RE.test(customerPhone.trim())) {
      setError('Escribe un celular/WhatsApp válido (7 a 20 dígitos).');
      return;
    }
    if (!color) {
      setError('Selecciona el color elegido por el cliente.');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/tickets', {
        method: 'POST',
        body: {
          customer_name: name,
          customer_email: customerEmail.trim(),
          customer_document: customerDocument.trim(),
          customer_phone: customerPhone.trim(),
          selected_color: color,
          notes: notes.trim() || undefined,
        },
      });
      setSold(data);
      if (data.emailSent) toast(`Entrada enviada a ${data.ticket.customer_email}`, 'success');
      else toast(data.message, 'warning');
      setCustomerName('');
      setCustomerEmail('');
      setCustomerDocument('');
      setCustomerPhone('');
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
          <div className="sold-ticket">
            <TicketPreview
              color={t.selected_color}
              name={t.customer_name}
              number={t.ticket_number}
              code={t.short_code}
              eventName={t.event?.name || event?.name}
              eventDate={fmtDateOnly(t.event?.event_date || event?.event_date)}
              eventLocation={t.event?.location || event?.location}
              generated
            />
          </div>
          <div className="sold-meta">
            <span>{t.customer_name}</span>
            <span>{t.customer_email}</span>
            {t.customer_document || t.customer_phone ? (
              <span>
                {[t.customer_document ? `CI ${t.customer_document}` : null,
                  t.customer_phone ? `Cel. ${t.customer_phone}` : null].filter(Boolean).join(' · ')}
              </span>
            ) : null}
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

  const soldOut = remaining !== null && remaining <= 0;
  const sellDisabled = busy || !phase || noEvent || noAllocation || soldOut;

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
        <div className="panel form-warning" style={{ marginBottom: 0 }}>
          No tienes un cupo de entradas asignado para este evento. Pídele al administrador que te asigne uno.
        </div>
      ) : null}
      {soldOut && !noAllocation && ctxLoaded && !noEvent ? (
        <div className="panel form-warning" style={{ marginBottom: 0 }}>
          {isSeller ? 'Ya usaste todo tu cupo de entradas.' : 'Ya se vendieron todas las entradas disponibles.'}
        </div>
      ) : null}

      <div className="sell-layout">
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
                autoComplete="off"
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
                autoComplete="off"
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Cédula / documento *</span>
              <input
                value={customerDocument}
                onChange={(e) => setCustomerDocument(e.target.value)}
                placeholder="1104XXXXXX"
                minLength={5}
                maxLength={30}
                autoComplete="off"
                required
              />
            </label>
            <label className="field">
              <span>Celular / WhatsApp *</span>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="09XXXXXXXX"
                maxLength={20}
                autoComplete="off"
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
            {busy ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Generando entrada…
              </>
            ) : soldOut ? 'Sin cupo disponible'
              : 'REGISTRAR VENTA Y ENVIAR ENTRADA'}
          </button>
          <p className="form-note">
            Al registrar la venta se genera el QR único y se envía el PDF al correo del cliente automáticamente.
          </p>
        </form>

        <aside className="sell-preview">
          <h3>Vista previa de la entrada</h3>
          <TicketPreview
            color={color}
            name={customerName}
            number={ctx?.next_ticket_number}
            eventName={event?.name}
            eventDate={eventDateText}
            eventLocation={event?.location}
          />
          <div className="preview-chips">
            {phase ? (
              <span className="preview-chip">
                {phase.name} · <strong>{fmtMoney(phase.price)}</strong>
              </span>
            ) : null}
            {remaining !== null ? (
              <span className="preview-chip">
                {isSeller ? 'Tu cupo restante' : 'Disponibles'}: <strong>{remaining}</strong>
              </span>
            ) : null}
          </div>
          <p className="preview-note">
            El QR mostrado es una muestra. El QR real y único se genera al registrar
            la venta y viaja en el PDF que recibe el cliente.
          </p>
        </aside>
      </div>

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
