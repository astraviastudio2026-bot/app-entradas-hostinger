import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

// Verificación del correo vinculado de un usuario interno. Se llega desde
// el enlace del correo (?token=…); el token es de un solo uso y caduca en
// 24 horas. La página consume el token automáticamente al abrirse.
export default function VerificarCorreo() {
  const [params] = useSearchParams();
  const token = String(params.get('token') || '').trim();
  const [status, setStatus] = useState(token ? 'checking' : 'invalid');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true; // StrictMode monta dos veces: no gastar el token dos veces
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then((data) => {
        setMessage(data.message || 'Correo verificado correctamente.');
        setStatus('ok');
      })
      .catch((err) => {
        setMessage(err.message || 'El enlace de verificación es inválido o expiró.');
        setStatus('error');
      });
  }, [token]);

  return (
    <div className="login-screen">
      <div className="login-glow login-glow-a" />
      <div className="login-glow login-glow-b" />
      <div className="login-card">
        <div className="login-brand">
          <span className="login-flags">FLAGS</span>
          <span className="login-fest">— F E S T —</span>
        </div>
        <p className="login-tagline">Verificación de correo</p>

        {status === 'checking' ? (
          <div className="login-info">
            <p>Verificando tu correo…</p>
          </div>
        ) : status === 'ok' ? (
          <div className="login-info">
            <p>✓ {message}</p>
            <Link to="/login" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
              Iniciar sesión
            </Link>
          </div>
        ) : (
          <div className="login-info">
            <p className="form-error">
              {status === 'invalid'
                ? 'El enlace no es válido: falta el código de verificación.'
                : message}
            </p>
            <p className="login-help" style={{ marginTop: 10 }}>
              Pide al administrador reenviar el correo de verificación desde el panel de usuarios.
            </p>
            <Link to="/login" className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
              Ir al login
            </Link>
          </div>
        )}

        <div className="login-footer">
          <img src="/astravia-logo.jpg" alt="Astravia Studio" />
          <span>Desarrollado por ASTRAVIA STUDIO</span>
        </div>
      </div>
    </div>
  );
}
