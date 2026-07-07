import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

// Establecer la nueva contraseña con el token del correo (?token=…).
// El token es de un solo uso y caduca en 45 minutos.
export default function RestablecerContrasena() {
  const [params] = useSearchParams();
  const token = useMemo(() => String(params.get('token') || '').trim(), [params]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    try {
      const data = await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setMessage(data.message || 'Contraseña restablecida.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-glow login-glow-a" />
      <div className="login-glow login-glow-b" />
      <div className="login-card">
        <div className="login-brand">
          <span className="login-flags">FLAGS</span>
          <span className="login-fest">— F E S T —</span>
        </div>
        <p className="login-tagline">Nueva contraseña</p>

        {!token ? (
          <div className="login-info">
            <p className="form-error">El enlace no es válido: falta el código de recuperación.</p>
            <Link to="/recuperar-contrasena" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
              Solicitar un enlace nuevo
            </Link>
          </div>
        ) : message ? (
          <div className="login-info">
            <p>✓ {message}</p>
            <Link to="/login" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
              Iniciar sesión
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="login-form">
            <label className="field">
              <span>Nueva contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
                required
              />
            </label>
            <label className="field">
              <span>Repite la contraseña</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar nueva contraseña'}
            </button>
            <Link to="/login" className="login-forgot">← Volver al login</Link>
          </form>
        )}

        <div className="login-footer">
          <img src="/astravia-logo.jpg" alt="Astravia Studio" />
          <span>Desarrollado por ASTRAVIA STUDIO</span>
        </div>
      </div>
    </div>
  );
}
