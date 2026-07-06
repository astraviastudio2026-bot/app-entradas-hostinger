import React, { useEffect, useState } from 'react';
import { api } from '../api';
import {
  ColorBadge, EmptyState, Spinner, StatCard, TICKET_COLORS, fmtMoney,
} from '../components.jsx';

export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [sellers, setSellers] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/reports/summary').then(setSummary).catch((e) => setError(e.message));
    api('/reports/sellers').then((d) => setSellers(d.sellers)).catch((e) => setError(e.message));
  }, []);

  if (error) return <EmptyState text={error} />;
  if (!summary || !sellers) return <Spinner />;

  const currency = summary.currency;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reportes</h1>
          <p className="page-sub">Resumen general del evento</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Vendidas" value={summary.sold} hint={`de ${summary.total_limit}`} accent="pink" />
        <StatCard label="Disponibles" value={summary.available} accent="orange" />
        <StatCard label="Usadas" value={summary.used} />
        <StatCard label="Anuladas" value={summary.cancelled} />
        <StatCard label="Ingresos totales" value={fmtMoney(summary.revenue, currency)} accent="pink" />
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Ventas por color</h3>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr><th>Color</th><th>Vendidas</th><th>Ingresos</th></tr>
              </thead>
              <tbody>
                {Object.values(TICKET_COLORS).map((c) => {
                  const row = summary.by_color.find((b) => b.color === c.key) || {};
                  return (
                    <tr key={c.key}>
                      <td data-label="Color"><ColorBadge color={c.key} /> <span className="cell-sub">{c.concept}</span></td>
                      <td data-label="Vendidas">{Number(row.sold || 0)}</td>
                      <td data-label="Ingresos">{fmtMoney(row.revenue, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>Ventas por fase</h3>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr><th>Fase</th><th>Precio</th><th>Vendidas</th><th>Ingresos</th></tr>
              </thead>
              <tbody>
                {summary.by_phase.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Fase">{p.name}</td>
                    <td data-label="Precio">{fmtMoney(p.price, currency)}</td>
                    <td data-label="Vendidas">{Number(p.sold)}</td>
                    <td data-label="Ingresos">{fmtMoney(p.revenue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Reporte por vendedor</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Cupo</th>
                <th>Vendidas</th>
                <th>Usadas</th>
                <th>Anuladas</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                  <td data-label="Vendedor">
                    <div className="cell-main">{s.name}</div>
                    <div className="cell-sub">{s.email}</div>
                  </td>
                  <td data-label="Cupo">{s.quota}</td>
                  <td data-label="Vendidas">{Number(s.sold)}</td>
                  <td data-label="Usadas">{Number(s.used)}</td>
                  <td data-label="Anuladas">{Number(s.cancelled)}</td>
                  <td data-label="Ingresos">{fmtMoney(s.revenue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
