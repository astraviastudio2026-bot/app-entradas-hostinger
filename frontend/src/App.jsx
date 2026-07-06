import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, clearSession, getCurrency, getStoredUser, getToken, setSession } from './api';
import { ToastProvider } from './components.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Sellers from './pages/Sellers.jsx';
import Phases from './pages/Phases.jsx';
import SellTicket from './pages/SellTicket.jsx';
import Tickets from './pages/Tickets.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import Reports from './pages/Reports.jsx';
import Scanner from './pages/Scanner.jsx';

const AuthContext = createContext(null);
export function useAuth() {
  return useContext(AuthContext);
}

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: '⌂', roles: ['admin', 'seller'] },
  { to: '/vender', label: 'Vender', icon: '＋', roles: ['admin', 'seller'] },
  { to: '/entradas', label: 'Entradas', icon: '▤', roles: ['admin', 'seller'] },
  { to: '/scanner', label: 'Scanner', icon: '▣', roles: ['admin'] },
  { to: '/vendedores', label: 'Vendedores', icon: '☺', roles: ['admin'] },
  { to: '/fases', label: 'Fases', icon: '◔', roles: ['admin'] },
  { to: '/reportes', label: 'Reportes', icon: '≡', roles: ['admin'] },
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
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link">
              <span className="nav-icon">{i.icon}</span>
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <strong>{user.name}</strong>
              <span>{user.role === 'admin' ? 'Administrador' : 'Vendedor'}</span>
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
            {items.find((i) => (i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to)))?.label || ''}
          </span>
          <button type="button" className="icon-btn" onClick={logout} title="Cerrar sesión">⏻</button>
        </header>

        <main className="main">{children}</main>

        <nav className="bottom-nav">
          {items.slice(0, 5).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className="bottom-link">
              <span className="nav-icon">{i.icon}</span>
              <span>{i.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Protected({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">FLAGS FEST</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [currency, setCurrency] = useState(getCurrency());
  const [loading, setLoading] = useState(Boolean(getToken()));
  const navigate = useNavigate();

  useEffect(() => {
    // Revalida la sesion guardada al abrir la app
    if (!getToken()) return;
    api('/me')
      .then((data) => {
        setUser(data.user);
        setCurrency(data.currency || 'S/');
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      navigate('/login');
    };
    window.addEventListener('ff-unauthorized', onUnauthorized);
    return () => window.removeEventListener('ff-unauthorized', onUnauthorized);
  }, [navigate]);

  const value = useMemo(() => ({
    user,
    currency,
    loading,
    login: async (email, password) => {
      const data = await api('/login', { method: 'POST', body: { email, password } });
      setSession(data.token, data.user, data.currency);
      setUser(data.user);
      setCurrency(data.currency || 'S/');
      return data.user;
    },
    logout: () => {
      clearSession();
      setUser(null);
      navigate('/login');
    },
  }), [user, currency, loading, navigate]);

  return (
    <AuthContext.Provider value={value}>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/vender" element={<Protected><SellTicket /></Protected>} />
          <Route path="/entradas" element={<Protected><Tickets /></Protected>} />
          <Route path="/entradas/:id" element={<Protected><TicketDetail /></Protected>} />
          <Route path="/vendedores" element={<Protected adminOnly><Sellers /></Protected>} />
          <Route path="/fases" element={<Protected adminOnly><Phases /></Protected>} />
          <Route path="/reportes" element={<Protected adminOnly><Reports /></Protected>} />
          <Route path="/scanner" element={<Protected adminOnly><Scanner /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthContext.Provider>
  );
}
