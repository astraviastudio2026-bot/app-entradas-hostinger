import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App.jsx';
import {
  ColorBadge, EmptyState, Spinner, StatCard, StatusBadge, TICKET_COLORS, fmtDate, fmtMoney,
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

function PhaseCard({ phase, currency }) {
  return (
    <div className="panel phase-panel">
      <h3>Fase de venta vigente</h3>
      {phase ? (
        <>
          <div className="phase-name">{phase.name}</div>
          <div className="phase-price">{fmtMoney(phase.price, currency)}</div>
          <div className="phase-dates">
            {fmtDate(phase.start_date)} → {fmtDate(phase.end_date)}
          </div>
        </>
      ) : (
        <div className="phase-none">
          ⚠ No hay fase vigente ahora mismo. No se pueden registrar ventas.
        </div>
      )}
    </div>
  );
}

function RecentTickets({ tickets }) {
  if (!tickets.length) return <EmptyState text="Aún no hay ventas registradas" />;
  return (
    <div className="recent-list">
      {tickets.map((t) => (
        <Link key={t.id} to={`/entradas/${t.id}`} className="recent-item">
          <span className="recent-code">{t.code}</span>
          <span className="recent-buyer">{t.buyer_name}</span>
          <ColorBadge color={t.selected_color} />
          <StatusBadge status={t.status} />
        </Link>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user, currency } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <EmptyState text={error} />;
  if (!data) return <Spinner />;

  const isAdmin = data.role === 'admin';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hola, {user.name.split(' ')[0]} 👋</h1>
          <p className="page-sub">
            {isAdmin ? 'Resumen general del evento' : 'Tu resumen de ventas'}
          </p>
        </div>
        <Link to="/vender" className="btn btn-primary">+ Vender entrada</Link>
      </div>

      {isAdmin ? (
        <>
          <div className="stat-grid">
            <StatCard label="Vendidas" value={data.global_sold} hint={`de ${data.total_limit}`} accent="pink" />
            <StatCard label="Disponibles" value={data.global_available} accent="orange" />
            <StatCard label="Usadas (ingresaron)" value={data.used} />
            <StatCard label="Anuladas" value={data.cancelled} />
            <StatCard label="Ingresos" value={fmtMoney(data.revenue, currency)} accent="pink" />
            <StatCard label="Vendedores activos" value={data.active_sellers} />
          </div>
          <div className="two-col">
            <PhaseCard phase={data.active_phase} currency={currency} />
            <div className="panel">
              <h3>Ventas por color</h3>
              <ColorBars byColor={data.by_color} total={data.global_sold} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Últimas ventas</h3>
              <Link to="/entradas" className="link">Ver todas →</Link>
            </div>
            <RecentTickets tickets={data.recent_tickets} />
          </div>
        </>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Tu cupo" value={data.quota} accent="orange" />
            <StatCard label="Vendidas" value={data.my_sold} accent="pink" />
            <StatCard label="Te quedan" value={data.my_remaining} accent="green" />
            <StatCard label="Tus ingresos" value={fmtMoney(data.my_revenue, currency)} />
          </div>
          <div className="quota-panel panel">
            <div className="quota-track">
              <div
                className="quota-fill"
                style={{ width: `${data.quota > 0 ? Math.min(100, (data.my_sold / data.quota) * 100) : 0}%` }}
              />
            </div>
            <span className="quota-text">
              {data.my_sold} / {data.quota} entradas vendidas
              {data.global_available === 0 ? ' · EVENTO AGOTADO' : ''}
            </span>
          </div>
          <div className="two-col">
            <PhaseCard phase={data.active_phase} currency={currency} />
            <div className="panel">
              <h3>Disponibilidad global</h3>
              <div className="global-avail">
                <strong>{data.global_available}</strong>
                <span>entradas disponibles de {data.total_limit}</span>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Tus últimas ventas</h3>
              <Link to="/entradas" className="link">Ver todas →</Link>
            </div>
            <RecentTickets tickets={data.recent_tickets} />
          </div>
        </>
      )}
    </div>
  );
}
