import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, HOME_BY_ROLE } from '../App.jsx';

export default function Login() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await login(username.trim(), password);
      navigate(data.redirectTo || '/');
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
          <span className="login-sub">
            <em className="green">GREEN FLAGS</em> &amp; <em className="red">RED FLAGS</em> PARTY
          </span>
        </div>
        <p className="login-tagline">Elige tu color, vive la noche</p>

        <form onSubmit={submit} className="login-form">
          <label className="field">
            <span>Usuario</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="vendedor1"
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <div className="login-footer">
          <img src="/astravia-logo.jpg" alt="Astravia Studio" />
          <span>Desarrollado por ASTRAVIA STUDIO</span>
        </div>
      </div>
    </div>
  );
}
