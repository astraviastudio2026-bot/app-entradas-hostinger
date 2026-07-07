import React, { useEffect, useState } from 'react';
import { api } from '../api';
import {
  EmptyState, Modal, Spinner, fmtMoney, toInputDate, useToast,
} from '../components.jsx';
import PaymentSettings from '../components/PaymentSettings.jsx';

// Configuración del evento (uno activo a la vez) y sus fases de precio.
// Las fechas se ingresan como día de Ecuador (AAAA-MM-DD); el backend las
// convierte a UTC (inicio 00:00:00 EC, fin 23:59:59 EC).

function EventForm({ event, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: event?.name || 'FLAGS FEST',
    location: event?.location || '',
    event_date: event ? toInputDate(event.event_date) : '',
    total_tickets: event?.total_tickets ?? 600,
    is_active: event ? Boolean(event.is_active) : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/admin/events', {
        method: 'POST',
        body: {
          id: event?.id,
          name: form.name,
          location: form.location,
          event_date: form.event_date,
          total_tickets: Number(form.total_tickets),
          is_active: form.is_active,
        },
      });
      toast('Evento guardado', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel modal-form" style={{ marginBottom: 20 }}>
      <h3>{event ? 'Evento activo' : 'Crear evento'}</h3>
      <div className="form-row">
        <label className="field">
          <span>Nombre *</span>
          <input value={form.name} onChange={set('name')} required minLength={3} maxLength={160} />
        </label>
        <label className="field">
          <span>Lugar</span>
          <input value={form.location} onChange={set('location')} maxLength={160} placeholder="Paradox Club" />
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Fecha del evento *</span>
          <input type="date" value={form.event_date} onChange={set('event_date')} required />
        </label>
        <label className="field">
          <span>Total de entradas *</span>
          <input type="number" min="1" step="1" value={form.total_tickets} onChange={set('total_tickets')} required />
        </label>
      </div>
      <label className="check-field">
        <input type="checkbox" checked={form.is_active} onChange={set('is_active')} />
        <span>Evento activo (desactiva cualquier otro)</span>
      </label>
      {error ? <div className="form-error">{error}</div> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar evento'}
      </button>
    </form>
  );
}

function PhaseForm({ initial, nextOrder, onSaved, onClose }) {
  const toast = useToast();
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    phase_order: initial.phase_order,
    price: initial.price,
    max_tickets: initial.max_tickets ?? '',
    start_date: toInputDate(initial.starts_at),
    end_date: toInputDate(initial.ends_at),
    is_active: Boolean(initial.is_active),
  } : {
    name: '', phase_order: nextOrder, price: '', max_tickets: '', start_date: '', end_date: '', is_active: true,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/admin/phases', {
        method: 'POST',
        body: {
          id: initial?.id,
          name: form.name,
          phase_order: Number(form.phase_order),
          price: Number(form.price),
          max_tickets: form.max_tickets === '' ? null : Number(form.max_tickets),
          start_date: form.start_date,
          end_date: form.end_date,
          is_active: form.is_active,
        },
      });
      toast(isEdit ? 'Fase actualizada' : 'Fase creada', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? `Editar: ${initial.name}` : 'Nueva fase de venta'} onClose={onClose}>
      <form onSubmit={submit} className="modal-form">
        <div className="form-row">
          <label className="field">
            <span>Nombre *</span>
            <input value={form.name} onChange={set('name')} required maxLength={80} placeholder="Ej. Preventa" />
          </label>
          <label className="field">
            <span>Orden *</span>
            <input type="number" min="1" step="1" value={form.phase_order} onChange={set('phase_order')} required />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Precio *</span>
            <input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required />
          </label>
          <label className="field">
            <span>Cupo de entradas de la fase</span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.max_tickets}
              onChange={set('max_tickets')}
              placeholder="Vacío = sin cupo propio"
            />
          </label>
        </div>
        <p className="form-note" style={{ textAlign: 'left', marginTop: -6 }}>
          El cupo limita cuántas entradas pueden venderse/aprobarse en esta fase.
          La suma de cupos de todas las fases no puede superar el total del evento.
        </p>
        <div className="form-row">
          <label className="field">
            <span>Desde (día en Ecuador) *</span>
            <input type="date" value={form.start_date} onChange={set('start_date')} required />
          </label>
          <label className="field">
            <span>Hasta (día en Ecuador, inclusive) *</span>
            <input type="date" value={form.end_date} onChange={set('end_date')} required />
          </label>
        </div>
        <label className="check-field">
          <input type="checkbox" checked={form.is_active} onChange={set('is_active')} />
          <span>Fase activa</span>
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Evento() {
  const toast = useToast();
  const [event, setEvent] = useState(undefined); // undefined = cargando
  const [phases, setPhases] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'new' | fase

  const load = () => {
    api('/admin/events')
      .then((d) => setEvent(d.active_event))
      .catch((e) => setError(e.message));
    api('/admin/phases')
      .then((d) => { setPhases(d.phases); setCurrentId(d.current_phase_id); })
      .catch(() => {});
  };
  useEffect(load, []);

  const togglePhase = async (p) => {
    try {
      await api('/admin/phases', {
        method: 'POST',
        body: {
          id: p.id,
          name: p.name,
          phase_order: p.phase_order,
          price: Number(p.price),
          start_date: toInputDate(p.starts_at),
          end_date: toInputDate(p.ends_at),
          is_active: !p.is_active,
        },
      });
      toast(p.is_active ? 'Fase desactivada' : 'Fase activada', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error) return <EmptyState text={error} />;
  if (event === undefined) return <Spinner />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Evento y fases</h1>
          <p className="page-sub">La fase vigente define el precio automáticamente al vender</p>
        </div>
        {event ? (
          <button type="button" className="btn btn-primary" onClick={() => setModal('new')}>
            + Nueva fase
          </button>
        ) : null}
      </div>

      <EventForm event={event} onSaved={load} />

      {/* Advertencias internas de configuración de cupos */}
      {event && phases.length ? (() => {
        const activePhases = phases.filter((p) => p.is_active);
        const noQuota = activePhases.filter((p) => p.max_tickets == null);
        const assigned = phases.reduce((acc, p) => acc + (p.max_tickets != null ? Number(p.max_tickets) : 0), 0);
        const warnings = [];
        if (noQuota.length) {
          warnings.push(`Las fases activas sin cupo propio (${noQuota.map((p) => p.name).join(', ')}) `
            + 'venden contra el total del evento y el auto-avance no puede detectar cuándo "se agotan". '
            + 'Se recomienda definir cupo en todas las fases.');
        }
        if (assigned > 0 && assigned < event.total_tickets && !noQuota.length) {
          warnings.push(`Hay ${event.total_tickets - assigned} entradas del total (${event.total_tickets}) sin asignar a ninguna fase: `
            + 'no podrán venderse hasta ampliar algún cupo.');
        }
        return warnings.length ? (
          <div className="panel form-warning" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {warnings.map((w) => <span key={w}>⚠ {w}</span>)}
          </div>
        ) : null;
      })() : null}

      {!event ? null : !phases.length ? (
        <EmptyState text="Aún no hay fases de venta. Crea la primera." />
      ) : (
        <>
          <div className="phase-grid">
            {phases.map((p) => {
              const sold = Number(p.tickets_sold) || 0;
              const hasQuota = p.max_tickets != null;
              const quota = hasQuota ? Number(p.max_tickets) : null;
              const soldOut = hasQuota && sold >= quota;
              const pct = hasQuota && quota > 0 ? Math.min(100, Math.round((sold / quota) * 100)) : 0;
              return (
                <div key={p.id} className={`panel phase-card${p.id === currentId ? ' phase-current' : ''}${p.is_active ? '' : ' phase-off'}`}>
                  <div className="phase-card-head">
                    <h3>{p.phase_order}. {p.name}</h3>
                    {soldOut ? <span className="soldout-badge">AGOTADA</span>
                      : p.id === currentId ? <span className="live-badge">VIGENTE</span> : null}
                  </div>
                  <div className="phase-price">{fmtMoney(p.price)}</div>
                  <div className="phase-dates">
                    <span>{toInputDate(p.starts_at)}</span>
                    <span>→ {toInputDate(p.ends_at)} (hora Ecuador)</span>
                  </div>
                  {hasQuota ? (
                    <>
                      <div className="quota-track phase-quota-track">
                        <div className={`quota-fill${soldOut ? ' quota-full' : ''}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="phase-sold">
                        {sold} / {quota} vendidas · {Math.max(0, quota - sold)} restantes ({pct}%)
                      </div>
                    </>
                  ) : (
                    <div className="phase-sold">{sold} vendidas · sin cupo propio (usa el total del evento)</div>
                  )}
                  <div className="row-actions">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal(p)}>Editar</button>
                    <button
                      type="button"
                      className={`btn btn-sm ${p.is_active ? 'btn-danger' : 'btn-primary'}`}
                      onClick={() => togglePhase(p)}
                    >
                      {p.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Resumen interno de cupos por fase (nunca visible al público) */}
          <div className="panel">
            <h3>Cupos por fase</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fase</th><th>Fechas</th><th>Precio</th><th>Cupo</th>
                    <th>Vendidas</th><th>Restantes</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map((p) => {
                    const sold = Number(p.tickets_sold) || 0;
                    const hasQuota = p.max_tickets != null;
                    const quota = hasQuota ? Number(p.max_tickets) : null;
                    const soldOut = hasQuota && sold >= quota;
                    const ended = new Date(p.ends_at).getTime() < Date.now();
                    return (
                      <tr key={p.id} className={p.is_active ? '' : 'row-muted'}>
                        <td data-label="Fase"><span className="cell-main">{p.phase_order}. {p.name}</span></td>
                        <td data-label="Fechas">{toInputDate(p.starts_at)} → {toInputDate(p.ends_at)}</td>
                        <td data-label="Precio">{fmtMoney(p.price)}</td>
                        <td data-label="Cupo">{hasQuota ? quota : 'Sin cupo'}</td>
                        <td data-label="Vendidas">{sold}</td>
                        <td data-label="Restantes">{hasQuota ? Math.max(0, quota - sold) : '—'}</td>
                        <td data-label="Estado">
                          {!p.is_active ? <span className="status-badge">Inactiva</span>
                            : soldOut ? <span className="status-badge status-rejected">Agotada</span>
                              : p.id === currentId ? <span className="status-badge status-approved">Vigente</span>
                                : ended ? <span className="status-badge">Finalizada</span>
                                  : <span className="status-badge status-pending">Próxima</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="cell-sub" style={{ marginTop: 10 }}>
              Cupo asignado a fases:{' '}
              <strong>
                {phases.reduce((acc, p) => acc + (p.max_tickets != null ? Number(p.max_tickets) : 0), 0)}
              </strong>{' '}
              de <strong>{event.total_tickets}</strong> entradas totales del evento.
              El público nunca ve estas cantidades: en /comprar solo se muestra “Cupos limitados”.
            </p>
          </div>
        </>
      )}

      {event ? <PaymentSettings /> : null}

      {modal ? (
        <PhaseForm
          initial={modal === 'new' ? null : modal}
          nextOrder={phases.length + 1}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      ) : null}
    </div>
  );
}
