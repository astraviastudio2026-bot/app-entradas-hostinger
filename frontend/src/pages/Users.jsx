import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../App.jsx';
import { EmptyState, Modal, ROLE_LABELS, Spinner, useToast } from '../components.jsx';

const EMPTY_FORM = { full_name: '', username: '', email: '', password: '', role: 'seller' };

function UserForm({ onSaved, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...form };
      if (!body.email) delete body.email;
      await api('/admin/users', { method: 'POST', body });
      toast('Usuario creado', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Nuevo usuario" onClose={onClose}>
      <form onSubmit={submit} className="modal-form">
        <label className="field">
          <span>Nombre completo *</span>
          <input value={form.full_name} onChange={set('full_name')} required minLength={3} maxLength={120} />
        </label>
        <label className="field">
          <span>Usuario de acceso *</span>
          <input
            value={form.username}
            onChange={set('username')}
            required
            minLength={3}
            maxLength={60}
            autoCapitalize="none"
            placeholder="ej. vendedor1"
          />
        </label>
        <label className="field">
          <span>Rol *</span>
          <select value={form.role} onChange={set('role')}>
            <option value="seller">Vendedor</option>
            <option value="validator">Control de acceso (scanner)</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label className="field">
          <span>Contraseña *</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            minLength={8}
            required
            placeholder="Mínimo 8 caracteres"
          />
        </label>
        <label className="field">
          <span>Correo (opcional, informativo)</span>
          <input type="email" value={form.email} onChange={set('email')} maxLength={160} />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Fila de cupo editable (upsert en seller_allocations del evento activo)
function QuotaCell({ user, onSaved }) {
  const toast = useToast();
  const [value, setValue] = useState(user.allocated_quantity ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const qty = Number(value);
    if (!Number.isInteger(qty) || qty < 0) {
      toast('El cupo debe ser un entero mayor o igual a 0', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/admin/allocations', {
        method: 'POST',
        body: { seller_id: user.id, allocated_quantity: qty },
      });
      toast(`Cupo de ${user.full_name}: ${qty}`, 'success');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quota-edit">
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 72 }}
      />
      <button type="button" className="btn btn-sm btn-ghost" onClick={save} disabled={busy}>
        {busy ? '…' : 'Guardar'}
      </button>
    </div>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);

  const load = () => {
    api('/admin/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const toggleStatus = async (u) => {
    try {
      const d = await api(`/admin/users/${u.id}/toggle`, { method: 'POST' });
      toast(d.message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error) return <EmptyState text={error} />;
  if (!users) return <Spinner />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <p className="page-sub">
            Personal del evento: administradores, vendedores y control de acceso.
            El cupo se asigna por vendedor para el evento activo.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal(true)}>
          + Nuevo usuario
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Cupo</th>
              <th>Vendidas</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                <td data-label="Usuario">
                  <div className="cell-main">{u.full_name}</div>
                  <div className="cell-sub">{u.username}{u.email ? ` · ${u.email}` : ''}</div>
                </td>
                <td data-label="Rol">{ROLE_LABELS[u.role] || u.role}</td>
                <td data-label="Cupo">
                  {u.role === 'seller'
                    ? <QuotaCell user={u} onSaved={load} />
                    : '—'}
                </td>
                <td data-label="Vendidas">{u.role === 'seller' ? u.sold_count : '—'}</td>
                <td data-label="Estado">
                  <span className={`status-badge ${u.is_active ? 'status-sold' : 'status-cancelled'}`}>
                    {u.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td data-label="Acciones">
                  {u.id === me.id ? <span className="cell-sub">(tú)</span> : (
                    <button
                      type="button"
                      className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                      onClick={() => toggleStatus(u)}
                    >
                      {u.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal ? (
        <UserForm
          onClose={() => setModal(false)}
          onSaved={() => { setModal(false); load(); }}
        />
      ) : null}
    </div>
  );
}
