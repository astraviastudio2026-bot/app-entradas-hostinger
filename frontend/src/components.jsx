import React, { createContext, useCallback, useContext, useState } from 'react';

// Identidad de los colores de entrada (espejo de backend/src/colors.js)
export const TICKET_COLORS = {
  verde: {
    key: 'verde',
    label: 'Verde',
    concept: 'Soltero/a',
    description: 'Abierto/a a conocer a alguien especial',
    hex: '#2fd956',
  },
  rojo: {
    key: 'rojo',
    label: 'Rojo',
    concept: 'No busco nada',
    description: 'Disfruto la noche, sin etiquetas',
    hex: '#ff4040',
  },
  amarillo: {
    key: 'amarillo',
    label: 'Amarillo',
    concept: 'Depende',
    description: 'Todo puede pasar, déjate llevar',
    hex: '#ffc61a',
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

// Fechas siempre en hora de Ecuador (America/Guayaquil); la BD guarda UTC.
export function fmtDate(value, { withTime = true } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleString('es-EC', opts);
}

// Fecha UTC -> 'YYYY-MM-DD' del día correspondiente en Ecuador
// (para <input type="date">).
export function toInputDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
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
