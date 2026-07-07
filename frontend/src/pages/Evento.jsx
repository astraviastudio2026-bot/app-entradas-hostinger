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
    start_date: toInputDate(initial.starts_at),
    end_date: toInputDate(initial.ends_at),
    is_active: Boolean(initial.is_active),
  } : {
    name: '', phase_order: nextOrder, price: '', start_date: '', end_date: '', is_active: true,
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
        <label className="field">
          <span>Precio *</span>
          <input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required />
        </label>
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

      {!event ? null : !phases.length ? (
        <EmptyState text="Aún no hay fases de venta. Crea la primera." />
      ) : (
        <div className="phase-grid">
          {phases.map((p) => (
            <div key={p.id} className={`panel phase-card${p.id === currentId ? ' phase-current' : ''}${p.is_active ? '' : ' phase-off'}`}>
              <div className="phase-card-head">
                <h3>{p.phase_order}. {p.name}</h3>
                {p.id === currentId ? <span className="live-badge">VIGENTE</span> : null}
              </div>
              <div className="phase-price">{fmtMoney(p.price)}</div>
              <div className="phase-dates">
                <span>{toInputDate(p.starts_at)}</span>
                <span>→ {toInputDate(p.ends_at)} (hora Ecuador)</span>
              </div>
              <div className="phase-sold">{p.tickets_sold} entradas vendidas</div>
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
          ))}
        </div>
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
