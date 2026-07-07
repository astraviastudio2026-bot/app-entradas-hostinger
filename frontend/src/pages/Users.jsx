import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../App.jsx';
import { EmptyState, Modal, ROLE_LABELS, Spinner, fmtDate, useToast } from '../components.jsx';

const EMPTY_FORM = { full_name: '', username: '', email: '', password: '', role: 'seller' };

// Estado del correo vinculado de un usuario interno:
//   verificado (verde) · pendiente (amarillo) · sin correo (gris)
// y, aparte, bloqueado temporalmente (rojo) por intentos fallidos.
function emailStatus(u) {
  if (!u.email) return { key: 'none', label: 'Sin correo' };
  if (u.email_verified_at) return { key: 'ok', label: 'Verificado' };
  return { key: 'pending', label: 'Pendiente' };
}

function isLocked(u) {
  return u.locked_until && new Date(u.locked_until).getTime() > Date.now();
}

function EmailBadge({ user }) {
  const st = emailStatus(user);
  return <span className={`email-badge email-badge-${st.key}`}>{st.label}</span>;
}

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
      const d = await api('/admin/users', { method: 'POST', body });
      toast(d.message || 'Usuario creado', d.verification_email_sent === false ? 'error' : 'success');
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
          <span>Correo vinculado (opcional)</span>
          <input
            type="email"
            value={form.email}
            onChange={set('email')}
            maxLength={160}
            placeholder="Se enviará un correo de verificación"
          />
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

// Editar usuario existente: nombre, correo vinculado (agregar / cambiar /
// limpiar), rol y contraseña manual (opcional; vacío = no cambiarla).
function UserEditForm({ user, me, onSaved, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: user.full_name,
    email: user.email || '',
    role: user.role,
    password: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = {
        full_name: form.full_name,
        email: form.email.trim() || null, // null = limpiar el correo
        role: form.role,
      };
      if (form.password) body.password = form.password;
      const d = await api(`/admin/users/${user.id}`, { method: 'PUT', body });
      toast(d.message || 'Usuario actualizado', d.verification_email_sent === false ? 'error' : 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Editar · ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="modal-form">
        <label className="field">
          <span>Nombre completo *</span>
          <input value={form.full_name} onChange={set('full_name')} required minLength={3} maxLength={120} />
        </label>
        <label className="field">
          <span>Correo vinculado</span>
          <input
            type="email"
            value={form.email}
            onChange={set('email')}
            maxLength={160}
            placeholder="Vacío = quitar el correo"
          />
        </label>
        {user.email && form.email.trim().toLowerCase() !== String(user.email).toLowerCase() ? (
          <p className="field-hint">
            Al cambiar o quitar el correo, el estado vuelve a «pendiente» y se
            reenvía la verificación al correo nuevo.
          </p>
        ) : null}
        <label className="field">
          <span>Rol *</span>
          <select value={form.role} onChange={set('role')} disabled={user.id === me.id}>
            <option value="seller">Vendedor</option>
            <option value="validator">Control de acceso (scanner)</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label className="field">
          <span>Nueva contraseña (opcional)</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            minLength={8}
            placeholder="Vacío = mantener la actual"
            autoComplete="new-password"
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
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
  const [editing, setEditing] = useState(null);
  const [resending, setResending] = useState(null);

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

  const resendVerification = async (u) => {
    setResending(u.id);
    try {
      const d = await api(`/admin/users/${u.id}/send-verification`, { method: 'POST' });
      toast(d.message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setResending(null);
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
            El correo vinculado permite recuperar la contraseña y recibir avisos de seguridad.
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
              <th>Correo</th>
              <th>Rol</th>
              <th>Cupo</th>
              <th>Vendidas</th>
              <th>Último acceso</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                <td data-label="Usuario">
                  <div className="cell-main">{u.full_name}</div>
                  <div className="cell-sub">{u.username}</div>
                </td>
                <td data-label="Correo">
                  {u.email ? <div className="cell-sub email-cell">{u.email}</div> : null}
                  <EmailBadge user={u} />
                  {u.email && !u.email_verified_at ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => resendVerification(u)}
                      disabled={resending === u.id}
                      title="Reenviar correo de verificación"
                    >
                      {resending === u.id ? 'Enviando…' : 'Reenviar'}
                    </button>
                  ) : null}
                </td>
                <td data-label="Rol">{ROLE_LABELS[u.role] || u.role}</td>
                <td data-label="Cupo">
                  {u.role === 'seller'
                    ? <QuotaCell user={u} onSaved={load} />
                    : '—'}
                </td>
                <td data-label="Vendidas">{u.role === 'seller' ? u.sold_count : '—'}</td>
                <td data-label="Último acceso">
                  <span className="cell-sub">{u.last_login_at ? fmtDate(u.last_login_at) : '—'}</span>
                </td>
                <td data-label="Estado">
                  {isLocked(u) ? (
                    <span className="email-badge email-badge-locked" title={`Bloqueado hasta ${fmtDate(u.locked_until)}`}>
                      Bloqueado
                    </span>
                  ) : (
                    <span className={`status-badge ${u.is_active ? 'status-sold' : 'status-cancelled'}`}>
                      {u.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  )}
                </td>
                <td data-label="Acciones">
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setEditing(u)}
                    >
                      Editar
                    </button>
                    {u.id === me.id ? <span className="cell-sub">(tú)</span> : (
                      <button
                        type="button"
                        className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </div>
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

      {editing ? (
        <UserEditForm
          user={editing}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      ) : null}
    </div>
  );
}
