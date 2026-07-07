import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// "Olvidé mi contraseña" (usuarios internos): pide el correo vinculado
// y el backend responde SIEMPRE genérico (no revela qué correos existen).
export default function RecuperarContrasena() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } });
      setMessage(data.message || 'Revisa tu correo.');
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
        <p className="login-tagline">Recuperar contraseña</p>

        {message ? (
          <div className="login-info">
            <p>✉ {message}</p>
            <Link to="/login" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
              Volver al login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="login-form">
            <p className="login-help">
              Escribe el correo vinculado a tu cuenta y te enviaremos un enlace
              para crear una nueva contraseña. El enlace caduca en 45 minutos.
            </p>
            <label className="field">
              <span>Correo electrónico</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                autoComplete="email"
                required
              />
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Enviando…' : 'Enviar enlace de recuperación'}
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
