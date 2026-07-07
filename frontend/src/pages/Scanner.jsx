import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../api';
import { ColorDot, TICKET_COLORS, fmtDate, fmtMoney, useToast } from '../components.jsx';

const RESULT_STYLES = {
  valid: { icon: '✓', title: 'ACCESO PERMITIDO', className: 'scan-valid' },
  already_used: { icon: '✕', title: 'YA FUE USADA', className: 'scan-used' },
  cancelled: { icon: '⊘', title: 'ENTRADA ANULADA', className: 'scan-cancelled' },
  invalid: { icon: '?', title: 'QR INVÁLIDO', className: 'scan-invalid' },
  error: { icon: '⚠', title: 'ERROR DE CONEXIÓN', className: 'scan-error' },
};

// Etiquetas del historial: una validación "valid" significa que la
// entrada ingresó correctamente en ese momento.
const HIST_LABELS = {
  valid: 'Válida',
  already_used: 'Usada',
  cancelled: 'Anulada',
  invalid: 'Inválida',
};

// Ventana en la que se ignora el mismo QR (evita validar dos veces la
// misma entrada por lecturas consecutivas de la cámara).
const DUPLICATE_MS = 4000;

// El recuadro de lectura se adapta al tamaño real del visor del móvil.
function qrboxSize(viewfinderWidth, viewfinderHeight) {
  const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
  return { width: Math.max(size, 160), height: Math.max(size, 160) };
}

// Mensaje claro según el motivo por el que no arrancó la cámara.
function cameraErrorMessage(err) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'Este navegador no soporta el acceso a la cámara. Usa Chrome (Android) o Safari (iPhone) actualizados, o valida por código manual.';
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'La cámara solo funciona con conexión segura (HTTPS). Abre la app desde el dominio oficial.';
  }
  const name = err?.name || '';
  const text = String(err?.message || err || '');
  if (name === 'NotAllowedError' || /denied|permission/i.test(text)) {
    return 'Permiso de cámara denegado. Actívalo en los ajustes del navegador (candado junto a la dirección) y vuelve a intentar.';
  }
  if (name === 'NotFoundError' || /no.*camera|not found/i.test(text)) {
    return 'No se encontró ninguna cámara en este dispositivo. Usa la validación por código manual.';
  }
  if (name === 'NotReadableError' || /in use|could not start/i.test(text)) {
    return 'La cámara está siendo usada por otra aplicación. Ciérrala y vuelve a intentar.';
  }
  return 'No se pudo iniciar la cámara. Revisa los permisos del navegador o usa la validación por código manual.';
}

export default function Scanner() {
  const toast = useToast();
  const scannerRef = useRef(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef({ text: '', at: 0 });
  const audioRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState('');
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [histQuery, setHistQuery] = useState('');

  const loadHistory = () => {
    api('/tickets/validations')
      .then((d) => { setHistory(d.validations); setStats(d.stats || null); })
      .catch(() => {});
  };
  useEffect(loadHistory, []);

  // Pitido de confirmación (WebAudio). El contexto se crea en el gesto
  // de "Iniciar cámara" para cumplir las políticas de iOS/Android.
  const beep = (ok) => {
    try {
      const ctx = audioRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const notes = ok ? [[880, 0, 0.12]] : [[240, 0, 0.1], [240, 0.16, 0.1]];
      notes.forEach(([freq, delay, dur]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.08, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + dur);
      });
    } catch { /* sin audio, no pasa nada */ }
  };

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
      const ok = data.status === 'valid';
      beep(ok);
      if (navigator.vibrate) navigator.vibrate(ok ? 120 : [90, 60, 90, 60, 90]);
    } catch (err) {
      // Falla de red/servidor: tarjeta clara con opción de reintentar.
      setResult({ status: 'error', message: err.message });
      beep(false);
      if (navigator.vibrate) navigator.vibrate([90, 60, 90]);
    } finally {
      busyRef.current = false;
    }
  };

  const onScan = (decodedText) => {
    const text = decodedText.trim();
    const now = Date.now();
    const last = lastScanRef.current;
    if (text === last.text && now - last.at < DUPLICATE_MS) return;
    lastScanRef.current = { text, at: now };
    validate('/tickets/validate', { scannedValue: text, source: 'scanner' });
  };

  const start = async () => {
    if (starting || running) return;
    setResult(null);
    setCameraError('');
    setStarting(true);
    if (!audioRef.current) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioRef.current = new Ctx();
      } catch { /* sin audio */ }
    }
    const config = {
      fps: 10,
      qrbox: qrboxSize,
      // iOS Safari exige estos atributos para reproducir video inline.
      videoConstraints: { facingMode: 'environment' },
    };
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      try {
        // Cámara trasera por defecto en móviles.
        await scanner.start({ facingMode: 'environment' }, config, onScan, () => {});
      } catch (err) {
        // Sin cámara trasera (PC/tablets): usar cualquier cámara disponible.
        const cams = await Html5Qrcode.getCameras();
        if (!cams || !cams.length) throw err;
        await scanner.start(cams[0].id, { fps: 10, qrbox: qrboxSize }, onScan, () => {});
      }
      setRunning(true);
      setPaused(false);
    } catch (err) {
      scannerRef.current = null;
      setCameraError(cameraErrorMessage(err));
    } finally {
      setStarting(false);
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
    if (audioRef.current) {
      audioRef.current.close().catch(() => {});
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

  const style = result ? RESULT_STYLES[result.status] || RESULT_STYLES.invalid : null;
  const tkColor = result?.ticket ? TICKET_COLORS[result.ticket.selected_color] : null;

  // Historial filtrado por nombre, código o correo (recientes primero,
  // tal como llega del backend)
  const q = histQuery.trim().toLowerCase();
  const filteredHistory = q
    ? history.filter((v) => [v.short_code, v.customer_name, v.customer_email]
      .some((f) => f && String(f).toLowerCase().includes(q)))
    : history;

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
              <p>{starting ? 'Iniciando cámara…' : 'La cámara está apagada'}</p>
            </div>
          ) : null}
          {cameraError ? <div className="form-error">{cameraError}</div> : null}
          <div className="scanner-controls">
            {!running ? (
              <button type="button" className="btn btn-primary btn-block btn-lg" onClick={start} disabled={starting}>
                {starting ? 'Iniciando…' : cameraError ? 'Reintentar cámara' : 'Iniciar cámara'}
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
              autoComplete="off"
              autoCapitalize="characters"
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
                <button type="button" className="btn btn-primary btn-block btn-lg" onClick={resumeCamera}>
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

          <div className="panel scan-hist-panel">
            <h3>Historial de validaciones</h3>

            {/* Resumen interno del ingreso (solo organizadores) */}
            {stats ? (
              <div className="scan-stats">
                <div className="scan-stat">
                  <span className="scan-stat-value">{stats.total}</span>
                  <span className="scan-stat-label">Vendidas</span>
                </div>
                <div className="scan-stat scan-stat-used">
                  <span className="scan-stat-value">{stats.used}</span>
                  <span className="scan-stat-label">Usadas · ingresaron</span>
                </div>
                <div className="scan-stat scan-stat-valid">
                  <span className="scan-stat-value">{stats.valid}</span>
                  <span className="scan-stat-label">Válidas por ingresar</span>
                </div>
              </div>
            ) : null}

            <input
              className="scan-hist-search"
              value={histQuery}
              onChange={(e) => setHistQuery(e.target.value)}
              placeholder="Buscar por nombre, código o correo…"
              autoComplete="off"
            />

            {!filteredHistory.length ? (
              <p className="cell-sub">
                {history.length ? 'Sin resultados para esa búsqueda' : 'Aún no hay validaciones'}
              </p>
            ) : (
              <div className="scan-cards">
                {filteredHistory.slice(0, 40).map((v) => {
                  const c = v.selected_color ? TICKET_COLORS[v.selected_color] : null;
                  return (
                    <div key={v.id} className={`scan-hist-card scan-hist-${v.result}`}>
                      <div className="scan-hist-top">
                        <span className="scan-hist-code">{v.short_code || 'QR desconocido'}</span>
                        <span className={`hist-badge hist-${v.result}`}>{HIST_LABELS[v.result] || v.result}</span>
                      </div>
                      <div className="scan-hist-name">{v.customer_name || '—'}</div>
                      <div className="scan-hist-meta">
                        {c ? (
                          <span className="scan-hist-color">
                            <ColorDot color={v.selected_color} /> {c.label}
                          </span>
                        ) : null}
                        {v.phase_name ? <span>{v.phase_name}</span> : null}
                        {v.customer_email ? <span className="scan-hist-email">{v.customer_email}</span> : null}
                      </div>
                      <div className="scan-hist-time">
                        {fmtDate(v.scanned_at)}
                        {v.validator_name ? ` · validó ${v.validator_name}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
