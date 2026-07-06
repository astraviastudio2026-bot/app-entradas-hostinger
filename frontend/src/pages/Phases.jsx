import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../App.jsx';
import {
  EmptyState, Modal, Spinner, fmtDate, fmtMoney, toInputDateTime, useToast,
} from '../components.jsx';

function PhaseForm({ initial, onSaved, onClose }) {
  const toast = useToast();
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(initial ? {
    name: initial.name,
    price: initial.price,
    start_date: toInputDateTime(initial.start_date),
    end_date: toInputDateTime(initial.end_date),
    is_active: Boolean(initial.is_active),
  } : { name: '', price: '', start_date: '', end_date: '', is_active: true });
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
      const body = { ...form, price: Number(form.price) };
      if (isEdit) await api(`/phases/${initial.id}`, { method: 'PUT', body });
      else await api('/phases', { method: 'POST', body });
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
        <label className="field">
          <span>Nombre *</span>
          <input value={form.name} onChange={set('name')} required maxLength={120} placeholder="Ej. Primera preventa" />
        </label>
        <label className="field">
          <span>Precio *</span>
          <input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Inicio *</span>
            <input type="datetime-local" value={form.start_date} onChange={set('start_date')} required />
          </label>
          <label className="field">
            <span>Fin *</span>
            <input type="datetime-local" value={form.end_date} onChange={set('end_date')} required />
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

export default function Phases() {
  const { currency } = useAuth();
  const toast = useToast();
  const [phases, setPhases] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  const load = () => {
    api('/phases')
      .then((d) => { setPhases(d.phases); setCurrentId(d.current_phase_id); })
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const toggle = async (p) => {
    try {
      const d = await api(`/phases/${p.id}/status`, { method: 'PATCH', body: { is_active: !p.is_active } });
      toast(d.message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error) return <EmptyState text={error} />;
  if (!phases) return <Spinner />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Fases de venta</h1>
          <p className="page-sub">La fase vigente se aplica automáticamente al vender</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal('new')}>
          + Nueva fase
        </button>
      </div>

      <div className="phase-grid">
        {phases.map((p) => (
          <div key={p.id} className={`panel phase-card${p.id === currentId ? ' phase-current' : ''}${p.is_active ? '' : ' phase-off'}`}>
            <div className="phase-card-head">
              <h3>{p.name}</h3>
              {p.id === currentId ? <span className="live-badge">VIGENTE</span> : null}
            </div>
            <div className="phase-price">{fmtMoney(p.price, currency)}</div>
            <div className="phase-dates">
              <span>{fmtDate(p.start_date)}</span>
              <span>→ {fmtDate(p.end_date)}</span>
            </div>
            <div className="phase-sold">{p.tickets_sold} entradas vendidas</div>
            <div className="row-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal(p)}>Editar</button>
              <button
                type="button"
                className={`btn btn-sm ${p.is_active ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => toggle(p)}
              >
                {p.is_active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal ? (
        <PhaseForm
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      ) : null}
    </div>
  );
}
