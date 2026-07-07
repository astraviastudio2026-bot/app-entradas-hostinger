import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App.jsx';
import {
  ColorBadge, EmptyState, Spinner, StatCard, TICKET_COLORS, fmtDate, fmtDateOnly, fmtMoney,
} from '../components.jsx';

function ColorBars({ byColor, total }) {
  return (
    <div className="color-bars">
      {Object.values(TICKET_COLORS).map((c) => {
        const row = byColor.find((b) => b.color === c.key);
        const sold = Number(row?.sold || 0);
        const pct = total > 0 ? Math.round((sold / total) * 100) : 0;
        return (
          <div key={c.key} className="color-bar-row">
            <span className="color-bar-label"><ColorBadge color={c.key} /></span>
            <div className="color-bar-track">
              <div className="color-bar-fill" style={{ width: `${pct}%`, background: c.hex }} />
            </div>
            <span className="color-bar-count">{sold}</span>
          </div>
        );
      })}
    </div>
  );
}

const RESULT_LABELS = {
  valid: 'Válida',
  already_used: 'Ya usada',
  cancelled: 'Anulada',
  invalid: 'Inválida',
};

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <EmptyState text={error} />;
  if (!data) return <Spinner />;

  if (!data.event) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Hola, {user.full_name.split(' ')[0]} 👋</h1></div></div>
        <EmptyState text="No hay evento activo configurado. Créalo en la sección Evento." />
        <Link to="/evento" className="btn btn-primary">Configurar evento</Link>
      </div>
    );
  }

  const m = data.metrics;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hola, {user.full_name.split(' ')[0]} 👋</h1>
          <p className="page-sub">
            {data.event.name} · {fmtDateOnly(data.event.event_date)}
            {data.event.location ? ` · ${data.event.location}` : ''}
          </p>
        </div>
        <Link to="/seller" className="btn btn-primary">+ Vender entrada</Link>
      </div>

      <div className="stat-grid">
        <StatCard label="Vendidas" value={m.sold} hint={`de ${m.total_tickets}`} accent="pink" />
        <StatCard label="Disponibles" value={m.available} accent="orange" />
        <StatCard label="Usadas (ingresaron)" value={m.used} />
        <StatCard label="Anuladas" value={m.cancelled} />
        <StatCard label="Ingresos" value={fmtMoney(m.revenue)} accent="pink" />
      </div>

      <div className="two-col">
        <div className="panel phase-panel">
          <h3>Fase de venta vigente</h3>
          {data.phase ? (
            <>
              <div className="phase-name">{data.phase.name}</div>
              <div className="phase-price">{fmtMoney(data.phase.price)}</div>
              <div className="phase-dates">
                {fmtDate(data.phase.starts_at, { withTime: false })} → {fmtDate(data.phase.ends_at, { withTime: false })}
              </div>
            </>
          ) : (
            <div className="phase-none">
              ⚠ No hay fase vigente ahora mismo. No se pueden registrar ventas.
            </div>
          )}
        </div>
        <div className="panel">
          <h3>Ventas por color</h3>
          <ColorBars byColor={m.by_color} total={m.sold} />
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Ventas y cupos por fase</h3>
          {!m.by_phase.length ? <p className="cell-sub">Sin fases configuradas</p> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Fase</th><th>Precio</th><th>Vendidas / Cupo</th><th>Estado</th><th>Ingresos</th></tr></thead>
                <tbody>
                  {m.by_phase.map((p) => {
                    const sold = Number(p.sold) || 0;
                    const hasQuota = p.max_tickets != null;
                    const quota = hasQuota ? Number(p.max_tickets) : null;
                    const soldOut = hasQuota && sold >= quota;
                    const ended = new Date(p.ends_at).getTime() < Date.now();
                    return (
                      <tr key={p.id} className={p.is_active ? '' : 'row-muted'}>
                        <td data-label="Fase">{p.name}</td>
                        <td data-label="Precio">{fmtMoney(p.price)}</td>
                        <td data-label="Vendidas / Cupo">
                          {sold} / {hasQuota ? quota : '—'}
                          {hasQuota ? <span className="cell-sub"> · {Math.max(0, quota - sold)} rest.</span> : null}
                        </td>
                        <td data-label="Estado">
                          {!p.is_active ? <span className="status-badge">Inactiva</span>
                            : soldOut ? <span className="status-badge status-rejected">Agotada</span>
                              : p.id === data.phase?.id ? <span className="status-badge status-approved">Activa</span>
                                : ended ? <span className="status-badge">Finalizada</span>
                                  : <span className="status-badge status-pending">Próxima</span>}
                        </td>
                        <td data-label="Ingresos">{fmtMoney(p.revenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="panel">
          <h3>Cupos por vendedor</h3>
          {!data.sellers.length ? <p className="cell-sub">Aún no hay vendedores</p> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Vendedor</th><th>Vendidas / Cupo</th><th>Ingresos</th></tr></thead>
                <tbody>
                  {data.sellers.map((s) => (
                    <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                      <td data-label="Vendedor">
                        <div className="cell-main">{s.full_name}</div>
                        <div className="cell-sub">{s.username}</div>
                      </td>
                      <td data-label="Vendidas / Cupo">
                        {s.sold} / {s.allocated_quantity ?? '—'}
                      </td>
                      <td data-label="Ingresos">{fmtMoney(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Últimas validaciones en puerta</h3>
          <Link to="/scanner" className="link">Ir al scanner →</Link>
        </div>
        {!data.recent_validations.length ? <p className="cell-sub">Aún no hay validaciones</p> : (
          <div className="scan-history">
            {data.recent_validations.map((v) => (
              <div key={v.id} className="scan-history-row">
                <span className={`scan-dot scan-dot-${v.result}`} />
                <span className="scan-history-code">{v.short_code || 'QR desconocido'}</span>
                <span className="scan-history-name">
                  {v.customer_name || '—'} · {RESULT_LABELS[v.result]}
                  {v.validator_name ? ` · por ${v.validator_name}` : ''}
                </span>
                <span className="scan-history-time">{fmtDate(v.scanned_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
