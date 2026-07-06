import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { EmptyState, Modal, Spinner, useToast } from '../components.jsx';

const EMPTY_FORM = { name: '', email: '', password: '', quota: 50 };

function SellerForm({ initial, onSaved, onClose }) {
  const toast = useToast();
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(initial
    ? { name: initial.name, email: initial.email, password: '', quota: initial.quota }
    : EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...form, quota: Number(form.quota) };
      if (isEdit && !body.password) delete body.password;
      if (isEdit) await api(`/users/${initial.id}`, { method: 'PUT', body });
      else await api('/users', { method: 'POST', body });
      toast(isEdit ? 'Vendedor actualizado' : 'Vendedor creado', 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? `Editar: ${initial.name}` : 'Nuevo vendedor'} onClose={onClose}>
      <form onSubmit={submit} className="modal-form">
        <label className="field">
          <span>Nombre *</span>
          <input value={form.name} onChange={set('name')} required maxLength={120} />
        </label>
        <label className="field">
          <span>Correo *</span>
          <input type="email" value={form.email} onChange={set('email')} required maxLength={190} />
        </label>
        <label className="field">
          <span>{isEdit ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            minLength={6}
            required={!isEdit}
            placeholder="Mínimo 6 caracteres"
          />
        </label>
        <label className="field">
          <span>Cupo de entradas *</span>
          <input type="number" min="0" step="1" value={form.quota} onChange={set('quota')} required />
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

export default function Sellers() {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'new' | user object

  const load = () => {
    api('/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const toggleStatus = async (u) => {
    try {
      const d = await api(`/users/${u.id}/status`, { method: 'PATCH', body: { is_active: !u.is_active } });
      toast(d.message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error) return <EmptyState text={error} />;
  if (!users) return <Spinner />;

  const sellers = users.filter((u) => u.role === 'seller');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vendedores</h1>
          <p className="page-sub">{sellers.length} vendedores registrados</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal('new')}>
          + Nuevo vendedor
        </button>
      </div>

      {!sellers.length ? <EmptyState text="Aún no hay vendedores. Crea el primero." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Cupo</th>
                <th>Vendidas</th>
                <th>Restantes</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                  <td data-label="Vendedor">
                    <div className="cell-main">{u.name}</div>
                    <div className="cell-sub">{u.email}</div>
                  </td>
                  <td data-label="Cupo">{u.quota}</td>
                  <td data-label="Vendidas">{u.sold_count}</td>
                  <td data-label="Restantes">{Math.max(0, u.quota - u.sold_count)}</td>
                  <td data-label="Estado">
                    <span className={`status-badge ${u.is_active ? 'status-sold' : 'status-cancelled'}`}>
                      {u.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td data-label="Acciones">
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal(u)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <SellerForm
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      ) : null}
    </div>
  );
}
