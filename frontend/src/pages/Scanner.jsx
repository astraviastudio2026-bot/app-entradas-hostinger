import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../api';
import { ColorDot, fmtDate, useToast } from '../components.jsx';

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
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState('');
  const [history, setHistory] = useState([]);

  const loadHistory = () => {
    api('/scan/history').then((d) => setHistory(d.scans)).catch(() => {});
  };
  useEffect(loadHistory, []);

  const processToken = async (token) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const data = await api('/scan', { method: 'POST', body: { token } });
      setResult(data);
      loadHistory();
      if (navigator.vibrate) navigator.vibrate(data.result === 'valid' ? 100 : [80, 60, 80]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      // pequeña pausa para no procesar el mismo QR muchas veces seguidas
      setTimeout(() => { busyRef.current = false; }, 1500);
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
        (decodedText) => processToken(decodedText.trim()),
        () => {}
      );
      setRunning(true);
    } catch (err) {
      toast('No se pudo iniciar la cámara. Revisa los permisos del navegador.', 'error');
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
  };

  useEffect(() => () => {
    // detener la cámara al salir de la pantalla
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
  }, []);

  const submitManual = (e) => {
    e.preventDefault();
    if (manual.trim()) {
      processToken(manual.trim());
      setManual('');
    }
  };

  const style = result ? RESULT_STYLES[result.result] : null;

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
              placeholder="O ingresa el token manualmente…"
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
                  <span className="scan-code">{result.ticket.code}</span>
                  <span className="scan-buyer">{result.ticket.buyer_name}</span>
                  <span className="scan-color">
                    <ColorDot color={result.ticket.color} /> {result.ticket.color_label}
                  </span>
                  <span className="scan-extra">{result.ticket.phase_name} · Vendida por {result.ticket.seller_name}</span>
                </div>
              ) : null}
              {result.result === 'already_used' ? (
                <p className="scan-note">Primer escaneo: {fmtDate(result.used_at)}</p>
              ) : null}
              {result.result === 'cancelled' && result.cancelled_at ? (
                <p className="scan-note">Anulada el {fmtDate(result.cancelled_at)}</p>
              ) : null}
              <p className="scan-message">{result.message}</p>
            </div>
          ) : (
            <div className="scan-result scan-waiting">
              <span className="scan-icon">⌖</span>
              <h2>Esperando escaneo…</h2>
              <p className="scan-note">Apunta la cámara al QR de la entrada</p>
            </div>
          )}

          <div className="panel">
            <h3>Historial de escaneos</h3>
            {!history.length ? <p className="cell-sub">Aún no hay escaneos</p> : (
              <div className="scan-history">
                {history.slice(0, 25).map((s) => (
                  <div key={s.id} className="scan-history-row">
                    <span className={`scan-dot scan-dot-${s.result}`} />
                    <span className="scan-history-code">{s.code || 'QR desconocido'}</span>
                    <span className="scan-history-name">{s.buyer_name || '—'}</span>
                    <span className="scan-history-time">{fmtDate(s.scanned_at)}</span>
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
