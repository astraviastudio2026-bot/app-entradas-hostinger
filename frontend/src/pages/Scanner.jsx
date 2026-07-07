import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../api';
import { ColorDot, TICKET_COLORS, fmtDate, fmtMoney, useToast } from '../components.jsx';

const RESULT_STYLES = {
  valid: { icon: '✓', title: 'ACCESO PERMITIDO', className: 'scan-valid' },
  already_used: { icon: '✕', title: 'YA FUE USADA', className: 'scan-used' },
  cancelled: { icon: '⊘', title: 'ENTRADA ANULADA', className: 'scan-cancelled' },
  invalid: { icon: '?', title: 'QR INVÁLIDO', className: 'scan-invalid' },
};

export default function Scanner() {
  const toast = useToast();
  const scannerRef = useRef(null);
  const busyRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState('');
  const [history, setHistory] = useState([]);

  const loadHistory = () => {
    api('/tickets/validations').then((d) => setHistory(d.validations)).catch(() => {});
  };
  useEffect(loadHistory, []);

  // Tras cada lectura el escáner queda en pausa: nunca se valida en bucle.
  const pauseCamera = () => {
    const s = scannerRef.current;
    if (s) {
      try { s.pause(true); setPaused(true); } catch { /* sin cámara */ }
    }
  };

  const resumeCamera = () => {
    setResult(null);
    const s = scannerRef.current;
    if (s) {
      try { s.resume(); setPaused(false); } catch { /* sin cámara */ }
    }
  };

  const validate = async (path, body) => {
    if (busyRef.current) return;
    busyRef.current = true;
    pauseCamera();
    try {
      const data = await api(path, { method: 'POST', body });
      setResult(data);
      loadHistory();
      if (navigator.vibrate) navigator.vibrate(data.status === 'valid' ? 100 : [80, 60, 80]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busyRef.current = false;
    }
  };

  const start = async () => {
    setResult(null);
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (decodedText) => validate('/tickets/validate', { scannedValue: decodedText.trim(), source: 'scanner' }),
        () => {}
      );
      setRunning(true);
      setPaused(false);
    } catch {
      toast('No se pudo iniciar la cámara. Revisa los permisos del navegador (requiere HTTPS).', 'error');
    }
  };

  const stop = async () => {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        await scanner.stop();
        scanner.clear();
      } catch { /* ya detenido */ }
      scannerRef.current = null;
    }
    setRunning(false);
    setPaused(false);
  };

  useEffect(() => () => {
    // detener la cámara al salir de la pantalla
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
  }, []);

  const submitManual = (e) => {
    e.preventDefault();
    const value = manual.trim();
    if (!value) return;
    setManual('');
    // Si parece un token/URL de QR se valida como escaneo; si no, como código FF-0001.
    if (/[a-f0-9]{40,64}/i.test(value) || value.includes('/ticket/validate/')) {
      validate('/tickets/validate', { scannedValue: value, source: 'manual' });
    } else {
      validate('/tickets/validate-code', { code: value });
    }
  };

  const style = result ? RESULT_STYLES[result.status] : null;
  const tkColor = result?.ticket ? TICKET_COLORS[result.ticket.selected_color] : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Scanner QR</h1>
          <p className="page-sub">Valida las entradas en el ingreso al evento</p>
        </div>
      </div>

      <div className="scanner-grid">
        <div className="panel scanner-panel">
          <div id="qr-reader" className={running ? 'qr-active' : ''} />
          {!running ? (
            <div className="scanner-placeholder">
              <span className="scanner-icon">▣</span>
              <p>La cámara está apagada</p>
            </div>
          ) : null}
          <div className="scanner-controls">
            {!running ? (
              <button type="button" className="btn btn-primary btn-block" onClick={start}>
                Iniciar cámara
              </button>
            ) : (
              <button type="button" className="btn btn-danger btn-block" onClick={stop}>
                Detener cámara
              </button>
            )}
          </div>
          <form onSubmit={submitManual} className="manual-scan">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Validar por código: FF-0001"
            />
            <button type="submit" className="btn btn-ghost">Validar</button>
          </form>
        </div>

        <div className="scanner-side">
          {result && style ? (
            <div className={`scan-result ${style.className}`}>
              <span className="scan-icon">{style.icon}</span>
              <h2>{style.title}</h2>
              {result.ticket ? (
                <div className="scan-ticket">
                  <span className="scan-code">{result.ticket.short_code}</span>
                  <span className="scan-buyer">{result.ticket.customer_name}</span>
                  {tkColor ? (
                    <span className="scan-color">
                      <ColorDot color={result.ticket.selected_color} /> {tkColor.label} · {tkColor.concept}
                    </span>
                  ) : null}
                  <span className="scan-extra">
                    {result.ticket.phase_name || '—'} · {fmtMoney(result.ticket.price)}
                    {result.ticket.seller_name ? ` · Vendida por ${result.ticket.seller_name}` : ''}
                  </span>
                </div>
              ) : null}
              {result.status === 'already_used' && result.ticket?.used_at ? (
                <p className="scan-note">
                  Primer ingreso: {fmtDate(result.ticket.used_at)}
                  {result.ticket.validated_by_name ? ` · validó ${result.ticket.validated_by_name}` : ''}
                </p>
              ) : null}
              <p className="scan-message">{result.message}</p>
              {running && paused ? (
                <button type="button" className="btn btn-primary btn-block" onClick={resumeCamera}>
                  Escanear siguiente
                </button>
              ) : null}
            </div>
          ) : (
            <div className="scan-result scan-waiting">
              <span className="scan-icon">⌖</span>
              <h2>{running ? 'Esperando escaneo…' : 'Cámara apagada'}</h2>
              <p className="scan-note">
                {running ? 'Apunta la cámara al QR de la entrada' : 'Inicia la cámara o valida por código manual'}
              </p>
            </div>
          )}

          <div className="panel">
            <h3>Historial de validaciones</h3>
            {!history.length ? <p className="cell-sub">Aún no hay validaciones</p> : (
              <div className="scan-history">
                {history.slice(0, 25).map((v) => (
                  <div key={v.id} className="scan-history-row">
                    <span className={`scan-dot scan-dot-${v.result}`} />
                    <span className="scan-history-code">{v.short_code || 'QR desconocido'}</span>
                    <span className="scan-history-name">{v.customer_name || '—'}</span>
                    <span className="scan-history-time">{fmtDate(v.scanned_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
