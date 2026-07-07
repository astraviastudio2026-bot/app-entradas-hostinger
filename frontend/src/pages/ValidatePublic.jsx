import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { TICKET_COLORS, fmtMoney } from '../components.jsx';

const RESULT_STYLES = {
  valid: { icon: '✓', title: 'ACCESO PERMITIDO', className: 'scan-valid' },
  already_used: { icon: '✕', title: 'YA FUE USADA', className: 'scan-used' },
  cancelled: { icon: '⊘', title: 'ENTRADA ANULADA', className: 'scan-cancelled' },
  invalid: { icon: '?', title: 'QR INVÁLIDO', className: 'scan-invalid' },
};

// Página PÚBLICA del enlace del QR. Abrir el enlace JAMÁS valida la
// entrada: solo el personal autorizado (admin/validator) con sesión activa
// ve el botón para validarla.
export default function ValidatePublic() {
  const { token } = useParams();
  const [me, setMe] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/auth/me').then((d) => setMe(d.user)).catch(() => setMe(null));
  }, []);

  const canValidate = me && (me.role === 'admin' || me.role === 'validator');

  const doValidate = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/tickets/validate', {
        method: 'POST',
        body: { scannedValue: token, source: 'link' },
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const style = result ? RESULT_STYLES[result.status] : null;
  const tkColor = result?.ticket ? TICKET_COLORS[result.ticket.selected_color] : null;

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

        {result && style ? (
          <div className={`scan-result ${style.className}`} style={{ marginTop: 18 }}>
            <span className="scan-icon">{style.icon}</span>
            <h2>{style.title}</h2>
            {result.ticket ? (
              <div className="scan-ticket">
                <span className="scan-code">{result.ticket.short_code}</span>
                <span className="scan-buyer">{result.ticket.customer_name}</span>
                {tkColor ? (
                  <span className="scan-color" style={{ color: tkColor.hex }}>
                    {tkColor.label} · {tkColor.concept}
                  </span>
                ) : null}
                <span className="scan-extra">
                  {result.ticket.phase_name || ''} · {fmtMoney(result.ticket.price)}
                </span>
              </div>
            ) : null}
            <p className="scan-message">{result.message}</p>
          </div>
        ) : (
          <div className="public-validate">
            <div className="public-qr-icon">▣</div>
            <h2>Código QR detectado</h2>
            <p>
              Esta entrada solo puede validarse con el <strong>escáner autorizado en la puerta</strong> del evento.
              Abrir este enlace no consume la entrada.
            </p>
            {canValidate ? (
              <>
                <p className="public-staff-note">
                  Sesión de personal detectada ({me.full_name}). Puedes validar esta entrada ahora:
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={busy}
                  onClick={doValidate}
                >
                  {busy ? 'Validando…' : 'Validar esta entrada'}
                </button>
              </>
            ) : (
              <p className="public-staff-note">
                Si eres parte del personal, inicia sesión en el sistema y usa el scanner.
              </p>
            )}
            {error ? <div className="form-error">{error}</div> : null}
          </div>
        )}

        <div className="login-footer">
          <img src="/astravia-logo.jpg" alt="Astravia Studio" />
          <span>FLAGS FEST · ASTRAVIA STUDIO</span>
        </div>
      </div>
    </div>
  );
}
