import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadPdf } from '../api';
import { useAuth } from '../App.jsx';
import {
  EmptyState, Spinner, StatusBadge, TICKET_COLORS, fmtDate, fmtMoney, useToast,
} from '../components.jsx';

export default function TicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => {
    api(`/tickets/${id}`).then((d) => setTicket(d.ticket)).catch((e) => setError(e.message));
  };
  useEffect(load, [id]);

  if (error) return <EmptyState text={error} />;
  if (!ticket) return <Spinner />;

  const c = TICKET_COLORS[ticket.selected_color];

  const doAction = async (name, fn) => {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const resend = () => doAction('resend', async () => {
    const d = await api(`/tickets/${ticket.id}/resend`, { method: 'POST' });
    toast(d.message, 'success');
    load();
  });

  const cancel = () => {
    const reason = window.prompt(
      `¿Anular la entrada ${ticket.short_code}? El QR dejará de ser válido y su cupo queda liberado.\n\nMotivo (opcional):`
    );
    if (reason === null) return;
    doAction('cancel', async () => {
      const d = await api(`/tickets/${ticket.id}/cancel`, { method: 'POST', body: { reason: reason || undefined } });
      toast(d.message, 'success');
      load();
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/entradas" className="link">← Entradas</Link>
          <h1 className="ticket-title">
            {ticket.short_code} <StatusBadge status={ticket.status} />
          </h1>
        </div>
      </div>

      <div className="ticket-hero" style={{ '--tk-color': c.hex }}>
        <div className="ticket-hero-left">
          <span className="tk-flags">FLAGS <em>FEST</em></span>
          <span className="tk-concept">{c.concept}</span>
          <span className="tk-desc">{c.description}</span>
        </div>
        <div className="ticket-hero-right">
          <span className="tk-code">{ticket.short_code}</span>
          <span className="tk-color-name">{c.label.toUpperCase()}</span>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Datos del cliente</h3>
          <dl className="detail-list">
            <div><dt>Nombre</dt><dd>{ticket.customer_name}</dd></div>
            <div><dt>Correo</dt><dd>{ticket.customer_email}</dd></div>
            <div><dt>Color elegido</dt><dd style={{ color: c.hex, fontWeight: 700 }}>{c.label} · {c.concept}</dd></div>
            {ticket.notes ? <div><dt>Observación</dt><dd>{ticket.notes}</dd></div> : null}
          </dl>
        </div>
        <div className="panel">
          <h3>Datos de la venta</h3>
          <dl className="detail-list">
            <div><dt>Nº de entrada</dt><dd>{String(ticket.ticket_number).padStart(4, '0')}</dd></div>
            <div><dt>Precio</dt><dd>{fmtMoney(ticket.price)}</dd></div>
            <div><dt>Fase</dt><dd>{ticket.phase_name || '—'}</dd></div>
            <div><dt>Vendedor</dt><dd>{ticket.seller_name}</dd></div>
            <div><dt>Vendida</dt><dd>{fmtDate(ticket.sold_at)}</dd></div>
            <div><dt>Usada</dt><dd>{fmtDate(ticket.used_at)}{ticket.validated_by_name ? ` · por ${ticket.validated_by_name}` : ''}</dd></div>
          </dl>
        </div>
      </div>

      <div className="panel actions-panel">
        <h3>Acciones</h3>
        <div className="actions-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy === 'pdf'}
            onClick={() => doAction('pdf', () => downloadPdf(ticket.id, ticket.short_code))}
          >
            {busy === 'pdf' ? 'Descargando…' : 'Descargar PDF'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy === 'resend' || ticket.status === 'cancelled'}
            onClick={resend}
          >
            {busy === 'resend' ? 'Enviando…' : 'Reenviar por correo'}
          </button>
          {user.role === 'admin' && ticket.status === 'sold' ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy === 'cancel'}
              onClick={cancel}
            >
              {busy === 'cancel' ? 'Anulando…' : 'Anular entrada'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
