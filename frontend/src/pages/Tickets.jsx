import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadPdf } from '../api';
import { useAuth } from '../App.jsx';
import {
  ColorBadge, EmptyState, Spinner, StatusBadge, TICKET_COLORS, fmtDate, fmtMoney, useToast,
} from '../components.jsx';

export default function Tickets() {
  const { user } = useAuth();
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  const [sellers, setSellers] = useState([]);
  const [phases, setPhases] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [color, setColor] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [busyRow, setBusyRow] = useState('');
  const [error, setError] = useState('');

  const isAdmin = user.role === 'admin';

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (color) params.set('color', color);
    if (sellerId) params.set('seller_id', sellerId);
    if (phaseId) params.set('phase_id', phaseId);
    api(`/tickets?${params.toString()}`)
      .then((d) => setTickets(d.tickets))
      .catch((e) => setError(e.message));
  };

  useEffect(load, [status, color, sellerId, phaseId]);
  useEffect(() => {
    if (!isAdmin) return;
    api('/admin/phases').then((d) => setPhases(d.phases)).catch(() => {});
    api('/admin/users').then((d) => setSellers(d.users.filter((u) => u.role === 'seller'))).catch(() => {});
  }, [isAdmin]);

  const totals = useMemo(() => {
    if (!tickets) return null;
    const sold = tickets.filter((t) => t.status !== 'cancelled');
    return {
      count: sold.length,
      revenue: sold.reduce((a, t) => a + Number(t.price), 0),
    };
  }, [tickets]);

  const resend = async (t) => {
    setBusyRow(t.id);
    try {
      const d = await api(`/tickets/${t.id}/resend`, { method: 'POST' });
      toast(d.message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyRow('');
    }
  };

  if (error) return <EmptyState text={error} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Entradas</h1>
          {totals ? (
            <p className="page-sub">
              {totals.count} vendidas en esta vista · {fmtMoney(totals.revenue)}
            </p>
          ) : null}
        </div>
        <Link to="/seller" className="btn btn-primary">+ Vender</Link>
      </div>

      <div className="filters">
        <form
          className="search-box"
          onSubmit={(e) => { e.preventDefault(); load(); }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar código, nombre o correo…"
          />
          <button type="submit" className="btn btn-ghost">Buscar</button>
        </form>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Estado: todos</option>
          <option value="sold">Vendidas</option>
          <option value="used">Usadas</option>
          <option value="cancelled">Anuladas</option>
        </select>
        <select value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="">Color: todos</option>
          {Object.values(TICKET_COLORS).map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        {isAdmin ? (
          <>
            <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
              <option value="">Fase: todas</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Vendedor: todos</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </>
        ) : null}
      </div>

      {!tickets ? <Spinner /> : !tickets.length ? (
        <EmptyState text="No hay entradas que coincidan con los filtros" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Cliente</th>
                <th>Color</th>
                <th>Precio</th>
                <th>Fase</th>
                {isAdmin ? <th>Vendedor</th> : null}
                <th>Fecha</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td data-label="Código">
                    <Link to={`/entradas/${t.id}`} className="code-link">{t.short_code}</Link>
                  </td>
                  <td data-label="Cliente">
                    <div className="cell-main">{t.customer_name}</div>
                    <div className="cell-sub">
                      {t.customer_email}
                      {t.customer_phone ? ` · ${t.customer_phone}` : ''}
                    </div>
                  </td>
                  <td data-label="Color"><ColorBadge color={t.selected_color} /></td>
                  <td data-label="Precio">{fmtMoney(t.price)}</td>
                  <td data-label="Fase">{t.phase_name}</td>
                  {isAdmin ? <td data-label="Vendedor">{t.seller_name}</td> : null}
                  <td data-label="Fecha">{fmtDate(t.sold_at)}</td>
                  <td data-label="Estado">
                    <StatusBadge status={t.status} />
                    {t.email_last_error && !t.email_sent_at ? (
                      <div className="cell-sub" title={t.email_last_error}>✉ correo pendiente</div>
                    ) : null}
                  </td>
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
                        {busyRow === t.id ? '…' : 'Reenviar'}
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
  );
}
