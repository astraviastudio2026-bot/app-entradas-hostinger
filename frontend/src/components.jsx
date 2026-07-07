import React, { createContext, useCallback, useContext, useState } from 'react';

// Identidad de los colores de entrada (espejo de backend/src/colors.js)
export const TICKET_COLORS = {
  verde: {
    key: 'verde',
    label: 'Verde',
    concept: 'Soltero/a',
    description: 'Abierto/a a conocer a alguien especial',
    phrase: 'Elige tu color, vive la noche.',
    hex: '#2fd956',
    soft: '#8affa8',
    darkBg: '#04170a',
    midBg: '#0b3d1a',
  },
  rojo: {
    key: 'rojo',
    label: 'Rojo',
    concept: 'No busco nada',
    description: 'Disfruto la noche, sin etiquetas',
    phrase: 'Sin etiquetas, solo disfruta.',
    hex: '#ff4040',
    soft: '#ff9d9d',
    darkBg: '#1b0404',
    midBg: '#521010',
  },
  amarillo: {
    key: 'amarillo',
    label: 'Amarillo',
    concept: 'Depende',
    description: 'Todo puede pasar, déjate llevar',
    phrase: 'Todo puede pasar.',
    hex: '#ffc61a',
    soft: '#ffe38f',
    darkBg: '#191204',
    midBg: '#584108',
  },
};

export const STATUS_LABELS = {
  sold: 'Vendida',
  used: 'Usada',
  cancelled: 'Anulada',
};

// Moneda del evento (Ecuador usa USD)
export const CURRENCY = '$';

export function fmtMoney(value) {
  return `${CURRENCY} ${Number(value || 0).toFixed(2)}`;
}

// ---- Fechas ----
// Del backend llegan DOS tipos de valores y NO se tratan igual:
//  · Columnas DATE puras (event_date): 'YYYY-MM-DD'. Son un día fijo sin
//    hora ni zona horaria: se muestran TAL CUAL, sin ninguna conversión
//    (convertirlas a Guayaquil restaba un día: 30/07 -> 29/07).
//  · Columnas DATETIME (sold_at, starts_at, ends_at…): instante UTC real;
//    se muestran convertidas a hora de Ecuador (America/Guayaquil).

const DATE_ONLY_RE = /^(\d{4}-\d{2}-\d{2})$/;
// Serialización antigua de una columna DATE: medianoche UTC exacta.
const UTC_MIDNIGHT_RE = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?Z$/;

// Fechas-hora siempre en hora de Ecuador; la BD guarda UTC.
export function fmtDate(value, { withTime = true } = {}) {
  if (!value) return '—';
  const only = String(value).match(DATE_ONLY_RE);
  if (only) return fmtDateOnly(only[1]); // DATE puro: sin conversión tz
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleString('es-EC', opts);
}

// Normaliza cualquier valor de fecha a 'YYYY-MM-DD':
//  · 'YYYY-MM-DD' (columna DATE) -> tal cual, día local fijo.
//  · medianoche UTC ISO (DATE serializado a la antigua) -> mismo día.
//  · DATETIME real -> día correspondiente en Ecuador.
export function normalizeDateOnly(value) {
  if (!value) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  const m = s.match(DATE_ONLY_RE) || s.match(UTC_MIDNIGHT_RE);
  if (m) return m[1];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
}

// 'YYYY-MM-DD' -> { year, month, day } numéricos (o null)
export function parseDateOnly(value) {
  const s = normalizeDateOnly(value);
  if (!s) return null;
  const [year, month, day] = s.split('-').map(Number);
  return { year, month, day };
}

// Fecha del evento (columna DATE, sin hora real) -> dd/mm/aaaa SIN conversión
// de zona horaria (espejo de formatDateOnly del backend: así el ticket en
// pantalla muestra el mismo día que el PDF y el correo).
export function fmtDateOnly(value) {
  const s = normalizeDateOnly(value);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

// Valor para <input type="date">: 'YYYY-MM-DD'. Un DATE puro pasa sin
// tocar; un DATETIME (fases) se traduce al día que representa en Ecuador.
export function toInputDate(value) {
  return normalizeDateOnly(value);
}

export const ROLE_LABELS = {
  admin: 'Administrador',
  seller: 'Vendedor',
  validator: 'Control de acceso',
};

export function ColorDot({ color }) {
  const c = TICKET_COLORS[color];
  return <span className="color-dot" style={{ background: c ? c.hex : '#888' }} />;
}

export function ColorBadge({ color }) {
  const c = TICKET_COLORS[color];
  if (!c) return <span>—</span>;
  return (
    <span className="color-badge" style={{ '--badge-color': c.hex }}>
      <ColorDot color={color} /> {c.label}
    </span>
  );
}

export function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

export function StatCard({ label, value, hint, accent }) {
  return (
    <div className={`stat-card${accent ? ` accent-${accent}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function Spinner({ text = 'Cargando…' }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---- sistema simple de toasts ----
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
