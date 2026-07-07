import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getStoredUser, storeUser } from './api';
import { ToastProvider, ROLE_LABELS } from './components.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Users from './pages/Users.jsx';
import Evento from './pages/Evento.jsx';
import Sell from './pages/Sell.jsx';
import Tickets from './pages/Tickets.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import Scanner from './pages/Scanner.jsx';
import ValidatePublic from './pages/ValidatePublic.jsx';

const AuthContext = createContext(null);
export function useAuth() {
  return useContext(AuthContext);
}

// Ruta de inicio según el rol (coincide con redirectTo del backend)
export const HOME_BY_ROLE = { admin: '/admin', seller: '/seller', validator: '/scanner' };

const NAV_ITEMS = [
  { to: '/admin', label: 'Inicio', icon: '⌂', roles: ['admin'] },
  { to: '/seller', label: 'Vender', icon: '＋', roles: ['admin', 'seller'] },
  { to: '/entradas', label: 'Entradas', icon: '▤', roles: ['admin', 'seller'] },
  { to: '/scanner', label: 'Scanner', icon: '▣', roles: ['admin', 'validator'] },
  { to: '/usuarios', label: 'Usuarios', icon: '☺', roles: ['admin'] },
  { to: '/evento', label: 'Evento', icon: '◔', roles: ['admin'] },
];

function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const items = NAV_ITEMS.filter((i) => i.roles.includes(user.role));

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-flags">FLAGS</span>
          <span className="brand-fest">— FEST —</span>
        </div>
        <nav className="side-nav">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} className="nav-link">
              <span className="nav-icon">{i.icon}</span>
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{user.full_name.slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <strong>{user.full_name}</strong>
              <span>{ROLE_LABELS[user.role] || user.role}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>
            Cerrar sesión
          </button>
          <div className="studio-brand">
            <img src="/astravia-logo.jpg" alt="Astravia Studio" />
            <span>ASTRAVIA STUDIO</span>
          </div>
        </div>
      </aside>

      <div className="content-col">
        <header className="topbar">
          <div className="brand brand-inline">
            <span className="brand-flags">FLAGS</span>
            <span className="brand-fest">FEST</span>
          </div>
          <span className="topbar-title">
            {items.find((i) => location.pathname.startsWith(i.to))?.label || ''}
          </span>
          <button type="button" className="icon-btn" onClick={logout} title="Cerrar sesión">⏻</button>
        </header>

        <main className="main">{children}</main>

        <nav className="bottom-nav">
          {items.slice(0, 5).map((i) => (
            <NavLink key={i.to} to={i.to} className="bottom-link">
              <span className="nav-icon">{i.icon}</span>
              <span>{i.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">FLAGS FEST</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
  }
  return <Layout>{children}</Layout>;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">FLAGS FEST</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role] || '/login'} replace />;
}

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Revalida la sesión de la cookie al abrir la app
    api('/auth/me')
      .then((data) => {
        setUser(data.user);
        storeUser(data.user);
      })
      .catch(() => {
        setUser(null);
        storeUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      if (!window.location.pathname.startsWith('/ticket/validate/')) navigate('/login');
    };
    window.addEventListener('ff-unauthorized', onUnauthorized);
    return () => window.removeEventListener('ff-unauthorized', onUnauthorized);
  }, [navigate]);

  const value = useMemo(() => ({
    user,
    loading,
    login: async (username, password) => {
      const data = await api('/auth/login', { method: 'POST', body: { username, password } });
      setUser(data.user);
      storeUser(data.user);
      return data;
    },
    logout: async () => {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch { /* la cookie igual expira */ }
      setUser(null);
      storeUser(null);
      navigate('/login');
    },
  }), [user, loading, navigate]);

  return (
    <AuthContext.Provider value={value}>
      <ToastProvider>
        <Routes>
          {/* pública: abrir el QR jamás valida la entrada */}
          <Route path="/ticket/validate/:token" element={<ValidatePublic />} />
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/admin" element={<Protected roles={['admin']}><Dashboard /></Protected>} />
          <Route path="/seller" element={<Protected roles={['admin', 'seller']}><Sell /></Protected>} />
          <Route path="/vender" element={<Navigate to="/seller" replace />} />
          <Route path="/entradas" element={<Protected roles={['admin', 'seller']}><Tickets /></Protected>} />
          <Route path="/entradas/:id" element={<Protected roles={['admin', 'seller']}><TicketDetail /></Protected>} />
          <Route path="/usuarios" element={<Protected roles={['admin']}><Users /></Protected>} />
          <Route path="/evento" element={<Protected roles={['admin']}><Evento /></Protected>} />
          <Route path="/scanner" element={<Protected roles={['admin', 'validator']}><Scanner /></Protected>} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </ToastProvider>
    </AuthContext.Provider>
  );
}
