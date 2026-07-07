import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import {
  ColorBadge, EmptyState, Modal, Spinner, StatCard, TICKET_COLORS, fmtDate, fmtMoney, useToast,
} from '../components.jsx';

const API = import.meta.env.VITE_API_URL || '/api';

export const WEB_STATUS = {
  pending: { label: 'Pendiente', className: 'status-pending' },
  approved: { label: 'Aprobada', className: 'status-approved' },
  rejected: { label: 'Rechazada', className: 'status-rejected' },
};

function WebStatusBadge({ status }) {
  const s = WEB_STATUS[status] || { label: status, className: '' };
  return <span className={`status-badge ${s.className}`}>{s.label}</span>;
}

// Comprobante embebido: imagen directa o enlace si es PDF. La URL es
// del endpoint autenticado (la cookie de sesión viaja sola al mismo origen).
function ProofView({ request }) {
  const url = `${API}/purchases/${request.id}/proof`;
  if (request.payment_proof_mime === 'application/pdf') {
    return (
      <div className="proof-pdf">
        <span>📄 {request.payment_proof_filename || 'comprobante.pdf'}</span>
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">Abrir PDF</a>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Abrir en tamaño completo">
      <img src={url} alt={`Comprobante ${request.request_code}`} className="proof-image" />
    </a>
  );
}

// Módulo interno "Compras web": revisión y validación manual de pagos.
// La entrada real (QR + PDF + correo) SOLO se genera al aprobar.
export default function ComprasWeb() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // ?rq=<id> viene de la campana de notificaciones: abre y destaca esa solicitud
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('rq');

  // filtros
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('pending');
  const [color, setColor] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // modales
  const [detail, setDetail] = useState(null);   // solicitud abierta
  const [approving, setApproving] = useState(null); // solicitud a confirmar
  const [rejecting, setRejecting] = useState(null); // solicitud a rechazar
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (color) params.set('color', color);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    api(`/purchases?${params.toString()}`)
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(load, [status, color, dateFrom, dateTo]);

  useEffect(() => {
    if (!highlightId) return;
    api(`/purchases/${highlightId}`)
      .then((d) => setDetail(d.request))
      .catch(() => {});
  }, [highlightId]);

  const closeDetail = () => {
    setDetail(null);
    if (highlightId) setSearchParams({}, { replace: true });
  };

  const approve = async (request) => {
    if (busy) return; // bloqueo anti doble clic
    setBusy(true);
    try {
      const d = await api(`/purchases/${request.id}/approve`, { method: 'POST' });
      toast(d.message, d.emailSent ? 'success' : 'warning');
      setApproving(null);
      closeDetail();
      load();
    } catch (err) {
      toast(err.message, 'error');
      setApproving(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const reject = async (request) => {
    if (busy) return;
    if (rejectReason.trim().length < 3) {
      toast('Escribe el motivo del rechazo.', 'error');
      return;
    }
    setBusy(true);
    try {
      const d = await api(`/purchases/${request.id}/reject`, {
        method: 'POST',
        body: { reason: rejectReason.trim() },
      });
      toast(d.message, d.emailSent ? 'success' : 'warning');
      setRejecting(null);
      setRejectReason('');
      closeDetail();
      load();
    } catch (err) {
      toast(err.message, 'error');
      setRejecting(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <EmptyState text={error} />;
  if (!data) return <Spinner />;

  const s = data.summary;
  const requests = data.requests || [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Compras web</h1>
          <p className="page-sub">
            Pagos por transferencia enviados desde la página pública ·{' '}
            <a href="/comprar" target="_blank" rel="noreferrer" className="link">/comprar ↗</a>
          </p>
        </div>
      </div>

      {s ? (
        <div className="stat-grid">
          <StatCard label="Pendientes" value={s.pending} accent={s.pending > 0 ? 'orange' : undefined} />
          <StatCard label="Aprobadas" value={s.approved} accent="green" />
          <StatCard label="Rechazadas" value={s.rejected} />
          <StatCard label="Recaudado aprobado" value={fmtMoney(s.approved_revenue)} accent="pink" />
          <StatCard label="Entradas restantes" value={s.tickets_available} />
        </div>
      ) : null}

      <div className="filters">
        <form className="search-box" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Código, nombre, correo o teléfono…"
          />
          <button type="submit" className="btn btn-ghost">Buscar</button>
        </form>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Estado: todos</option>
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobadas</option>
          <option value="rejected">Rechazadas</option>
        </select>
        <select value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="">Entrada: todas</option>
          {Object.values(TICKET_COLORS).map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Desde" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Hasta" />
      </div>

      {!requests.length ? (
        <EmptyState text="No hay solicitudes que coincidan con los filtros" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Comprador</th>
                <th>Entrada</th>
                <th>Fase</th>
                <th>Precio</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className={r.id === highlightId ? 'row-highlight' : ''}>
                  <td data-label="Código">
                    <button type="button" className="code-link link-btn" onClick={() => setDetail(r)}>
                      {r.request_code}
                    </button>
                  </td>
                  <td data-label="Comprador">
                    <div className="cell-main">{r.buyer_name}</div>
                    <div className="cell-sub">{r.buyer_email} · {r.buyer_phone}</div>
                  </td>
                  <td data-label="Entrada"><ColorBadge color={r.selected_color} /></td>
                  <td data-label="Fase">{r.phase_name || '—'}</td>
                  <td data-label="Precio">{fmtMoney(r.price)}</td>
                  <td data-label="Fecha">{fmtDate(r.created_at)}</td>
                  <td data-label="Estado">
                    <WebStatusBadge status={r.status} />
                    {r.ticket_short_code ? (
                      <div className="cell-sub">→ {r.ticket_short_code}</div>
                    ) : null}
                  </td>
                  <td data-label="Acciones">
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDetail(r)}>
                        Ver
                      </button>
                      {r.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-approve"
                            disabled={busy}
                            onClick={() => setApproving(r)}
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            disabled={busy}
                            onClick={() => { setRejecting(r); setRejectReason(''); }}
                          >
                            Rechazar
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- detalle ---------- */}
      {detail ? (
        <Modal title={`Solicitud ${detail.request_code}`} onClose={closeDetail}>
          <div className="purchase-detail">
            <div className="purchase-detail-head">
              <WebStatusBadge status={detail.status} />
              <ColorBadge color={detail.selected_color} />
            </div>
            <dl className="detail-list">
              <div><dt>Comprador</dt><dd>{detail.buyer_name}</dd></div>
              <div><dt>Correo</dt><dd>{detail.buyer_email}</dd></div>
              <div><dt>WhatsApp</dt><dd>{detail.buyer_phone}</dd></div>
              {detail.buyer_document ? <div><dt>Cédula / doc.</dt><dd>{detail.buyer_document}</dd></div> : null}
              <div><dt>Fase</dt><dd>{detail.phase_name || '—'}</dd></div>
              <div><dt>Precio esperado</dt><dd>{fmtMoney(detail.price)}</dd></div>
              <div><dt>Fecha de solicitud</dt><dd>{fmtDate(detail.created_at)}</dd></div>
              {detail.notes ? <div><dt>Observación</dt><dd>{detail.notes}</dd></div> : null}
              {detail.status === 'approved' ? (
                <>
                  <div><dt>Aprobada por</dt><dd>{detail.approved_by_name || '—'}</dd></div>
                  <div><dt>Aprobada el</dt><dd>{fmtDate(detail.approved_at)}</dd></div>
                  {detail.ticket_short_code ? (
                    <div>
                      <dt>Entrada generada</dt>
                      <dd>
                        <Link to={`/entradas/${detail.ticket_id}`} className="code-link">
                          {detail.ticket_short_code}
                        </Link>
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              {detail.status === 'rejected' ? (
                <>
                  <div><dt>Rechazada por</dt><dd>{detail.rejected_by_name || '—'}</dd></div>
                  <div><dt>Rechazada el</dt><dd>{fmtDate(detail.rejected_at)}</dd></div>
                  <div><dt>Motivo</dt><dd>{detail.rejection_reason || '—'}</dd></div>
                </>
              ) : null}
            </dl>

            <span className="field-label">Comprobante de pago</span>
            <ProofView request={detail} />

            {detail.status === 'pending' ? (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => { setRejecting(detail); setRejectReason(''); }}
                >
                  Rechazar
                </button>
                <button
                  type="button"
                  className="btn btn-approve"
                  disabled={busy}
                  onClick={() => setApproving(detail)}
                >
                  Aprobar pago
                </button>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {/* ---------- confirmación de aprobación ---------- */}
      {approving ? (
        <Modal title="Confirmar aprobación" onClose={() => !busy && setApproving(null)}>
          <div className="modal-form">
            <p className="confirm-text">
              Vas a aprobar el pago de <strong>{approving.buyer_name}</strong>{' '}
              ({approving.request_code} · {fmtMoney(approving.price)}).
            </p>
            <p className="confirm-text cell-sub">
              Se generará la entrada real con QR único y se enviará el PDF a{' '}
              <strong>{approving.buyer_email}</strong>. Esta acción no se puede deshacer
              (la entrada solo podría anularse después desde Entradas).
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setApproving(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-approve" disabled={busy} onClick={() => approve(approving)}>
                {busy ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" />
                    Generando entrada…
                  </>
                ) : 'Sí, aprobar y enviar entrada'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ---------- rechazo con motivo ---------- */}
      {rejecting ? (
        <Modal title={`Rechazar ${rejecting.request_code}`} onClose={() => !busy && setRejecting(null)}>
          <div className="modal-form">
            <p className="confirm-text cell-sub">
              El comprador recibirá un correo indicando que el pago no fue validado,
              con el motivo que escribas aquí.
            </p>
            <label className="field">
              <span>Motivo del rechazo *</span>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Ej. el comprobante no corresponde a nuestra cuenta / monto incorrecto"
                rows={3}
                maxLength={300}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => reject(rejecting)}>
                {busy ? 'Rechazando…' : 'Rechazar solicitud'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
