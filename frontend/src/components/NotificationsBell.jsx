import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ColorDot, fmtDate } from '../components.jsx';

// Campana de notificaciones internas (admin/organizadores).
// Polling liviano del contador cada 25 s; la lista se carga al abrir.
// Clic en una notificación -> /compras-web con la solicitud destacada.
const POLL_MS = 25000;

const REQ_STATUS = {
  pending: { label: 'Pendiente', className: 'status-pending' },
  approved: { label: 'Aprobada', className: 'status-approved' },
  rejected: { label: 'Rechazada', className: 'status-rejected' },
};

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export default function NotificationsBell() {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null = cargando

  const loadCount = useCallback(() => {
    api('/notifications/unread-count')
      .then((d) => setUnread(d.unread))
      .catch(() => {});
  }, []);

  const loadList = useCallback(() => {
    api('/notifications')
      .then((d) => setItems(d.notifications))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, POLL_MS);
    return () => clearInterval(t);
  }, [loadCount]);

  // Cerrar al hacer clic fuera del panel
  useEffect(() => {
    if (!open) return undefined;
    loadList();
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, loadList]);

  const openItem = (n) => {
    setOpen(false);
    if (!n.is_read) {
      setUnread((u) => Math.max(0, u - 1));
      api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    }
    if (n.related_type === 'purchase_request' && n.related_id) {
      navigate(`/compras-web?rq=${n.related_id}`);
    } else {
      navigate('/compras-web');
    }
  };

  const readAll = () => {
    setUnread(0);
    setItems((list) => (list ? list.map((n) => ({ ...n, is_read: 1 })) : list));
    api('/notifications/read-all', { method: 'POST' }).catch(() => {});
  };

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`icon-btn notif-btn${unread > 0 ? ' has-unread' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Notificaciones"
        aria-label={`Notificaciones${unread ? ` (${unread} sin leer)` : ''}`}
      >
        <BellIcon />
        {unread > 0 ? <span className="notif-badge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="notif-panel">
          <div className="notif-head">
            <h3>Notificaciones</h3>
            {items && items.some((n) => !n.is_read) ? (
              <button type="button" className="notif-readall" onClick={readAll}>
                Marcar todas leídas
              </button>
            ) : null}
          </div>
          {items === null ? (
            <div className="notif-empty">Cargando…</div>
          ) : !items.length ? (
            <div className="notif-empty">Sin notificaciones por ahora</div>
          ) : (
            <div className="notif-list">
              {items.map((n) => {
                const st = REQ_STATUS[n.request_status];
                return (
                  <button
                    type="button"
                    key={n.id}
                    className={`notif-item${n.is_read ? '' : ' unread'}`}
                    onClick={() => openItem(n)}
                  >
                    <span className="notif-dot" aria-hidden="true" />
                    <span className="notif-body">
                      <span className="notif-title">
                        {n.request_code || n.title}
                        {n.selected_color ? <ColorDot color={n.selected_color} /> : null}
                      </span>
                      <span className="notif-msg">{n.message}</span>
                      <span className="notif-meta">
                        {fmtDate(n.created_at)}
                        {st ? <span className={`status-badge ${st.className}`}>{st.label}</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="notif-foot">
            <button
              type="button"
              className="notif-readall"
              onClick={() => { setOpen(false); navigate('/compras-web'); }}
            >
              Ver todas las compras web →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
