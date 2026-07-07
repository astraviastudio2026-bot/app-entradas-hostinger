import React, { useEffect, useRef, useState } from 'react';
import { api, apiForm } from '../api';
import { Modal, Spinner, useToast } from '../components.jsx';

const API = import.meta.env.VITE_API_URL || '/api';

// Formulario de un banco/método de pago (crear o editar). El QR es
// propio de cada método.
function MethodForm({ initial, onSaved, onClose }) {
  const toast = useToast();
  const isEdit = Boolean(initial);
  const fileRef = useRef(null);
  const [qrFile, setQrFile] = useState(null);
  const [removeQr, setRemoveQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    bank_name: initial?.bank_name || '',
    account_type: initial?.account_type || '',
    account_number: initial?.account_number || '',
    account_holder: initial?.account_holder || '',
    account_document: initial?.account_document || '',
    transfer_note: initial?.transfer_note || '',
    sort_order: initial?.sort_order || '',
    is_active: initial ? Boolean(initial.is_active) : true,
  });

  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      if (initial) fd.append('id', initial.id);
      fd.append('bank_name', form.bank_name);
      fd.append('account_type', form.account_type);
      fd.append('account_number', form.account_number);
      fd.append('account_holder', form.account_holder);
      fd.append('account_document', form.account_document);
      fd.append('transfer_note', form.transfer_note);
      if (form.sort_order !== '') fd.append('sort_order', form.sort_order);
      fd.append('is_active', form.is_active ? '1' : '0');
      if (qrFile) fd.append('qr_image', qrFile);
      if (removeQr && !qrFile) fd.append('remove_qr_image', '1');
      const d = await apiForm('/admin/payment-methods', fd);
      toast(d.message, 'success');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? `Editar: ${initial.bank_name}` : 'Agregar banco / método de pago'} onClose={onClose}>
      <form onSubmit={submit} className="modal-form">
        <div className="form-row">
          <label className="field">
            <span>Banco *</span>
            <input value={form.bank_name} onChange={set('bank_name')} maxLength={120} placeholder="Banco de Loja" required />
          </label>
          <label className="field">
            <span>Tipo de cuenta</span>
            <input value={form.account_type} onChange={set('account_type')} maxLength={60} placeholder="Ahorros" />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Número de cuenta *</span>
            <input value={form.account_number} onChange={set('account_number')} maxLength={60} placeholder="2902113938" required />
          </label>
          <label className="field">
            <span>Titular de la cuenta *</span>
            <input value={form.account_holder} onChange={set('account_holder')} maxLength={120} placeholder="Nombre del titular" required />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Cédula / RUC del titular</span>
            <input value={form.account_document} onChange={set('account_document')} maxLength={30} />
          </label>
          <label className="field">
            <span>Orden de visualización</span>
            <input type="number" min="1" step="1" value={form.sort_order} onChange={set('sort_order')} placeholder="1" />
          </label>
        </div>
        <label className="field">
          <span>Nota adicional</span>
          <input
            value={form.transfer_note}
            onChange={set('transfer_note')}
            maxLength={300}
            placeholder="Ej. envía el valor exacto y conserva tu comprobante"
          />
        </label>
        <label className="field">
          <span>Imagen QR de pago de este banco (JPG/PNG/WEBP, máx. 2 MB)</span>
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(e) => { setQrFile(e.target.files?.[0] || null); setRemoveQr(false); }}
          />
        </label>
        {isEdit && initial.has_qr_image && !qrFile ? (
          <div className="payment-qr-row">
            <img
              src={`${API}/admin/payment-methods/${initial.id}/qr?v=${initial.id}`}
              alt={`QR de ${initial.bank_name}`}
              className="payment-qr-thumb"
            />
            <label className="check-field">
              <input type="checkbox" checked={removeQr} onChange={(e) => setRemoveQr(e.target.checked)} />
              <span>Quitar la imagen QR actual</span>
            </label>
          </div>
        ) : null}
        <label className="check-field">
          <input type="checkbox" checked={form.is_active} onChange={set('is_active')} />
          <span>Método activo (visible al público en /comprar)</span>
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar método'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Configuración de la venta web: lista de bancos/métodos (cada uno con
// su QR) + switch general y mensaje al comprador. Solo admin; vive
// dentro de la página Evento.
export default function PaymentSettings() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState([]);
  const [modal, setModal] = useState(null); // 'new' | método
  const [settings, setSettings] = useState({ public_sales_enabled: false, buyer_message: '' });

  const load = () => {
    api('/admin/payment-methods')
      .then((d) => setMethods(d.methods))
      .catch((e) => setError(e.message));
    api('/admin/payment-settings')
      .then((d) => {
        if (d.settings) {
          setSettings({
            public_sales_enabled: Boolean(d.settings.public_sales_enabled),
            buyer_message: d.settings.buyer_message || '',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  };
  useEffect(load, []);

  const toggleMethod = async (m) => {
    try {
      const d = await api(`/admin/payment-methods/${m.id}/toggle`, { method: 'POST' });
      toast(d.message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeMethod = async (m) => {
    if (!window.confirm(`¿Eliminar el método "${m.bank_name}"? Si ya tiene solicitudes asociadas, el sistema pedirá desactivarlo en su lugar.`)) return;
    try {
      const d = await api(`/admin/payment-methods/${m.id}`, { method: 'DELETE' });
      toast(d.message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api('/admin/payment-settings', {
        method: 'POST',
        body: {
          public_sales_enabled: settings.public_sales_enabled,
          buyer_message: settings.buyer_message,
        },
      });
      toast(d.message, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className="panel"><Spinner text="Cargando venta web…" /></div>;

  const activeCount = methods.filter((m) => m.is_active).length;

  return (
    <div className="panel payment-settings">
      <div className="panel-head">
        <h3>Venta web · bancos y métodos de pago</h3>
        <span className={`status-badge ${settings.public_sales_enabled && activeCount ? 'status-approved' : 'status-rejected'}`}>
          {settings.public_sales_enabled && activeCount ? 'ACTIVA' : 'DESACTIVADA'}
        </span>
      </div>
      <p className="cell-sub" style={{ margin: '4px 0 14px' }}>
        El público ve los métodos ACTIVOS en{' '}
        <a href="/comprar" target="_blank" rel="noreferrer" className="link">/comprar ↗</a>{' '}
        y elige a cuál transfirió. Cada solicitud guarda el banco usado y la
        contabilidad por cuenta se ve en <strong>Compras web</strong>.
      </p>

      {!methods.length ? (
        <div className="empty-state" style={{ marginBottom: 14 }}>
          Aún no hay bancos configurados. Agrega el primero para poder activar la venta web.
        </div>
      ) : (
        <div className="method-grid">
          {methods.map((m) => (
            <div key={m.id} className={`method-card${m.is_active ? '' : ' method-off'}`}>
              <div className="method-head">
                <strong className="method-bank">{m.bank_name}</strong>
                <span className={`status-badge ${m.is_active ? 'status-approved' : 'status-rejected'}`}>
                  {m.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div className="method-info">
                <span>{[m.account_type, m.account_number].filter(Boolean).join(' · ')}</span>
                <span className="cell-sub">{m.account_holder}{m.account_document ? ` · ${m.account_document}` : ''}</span>
                {m.transfer_note ? <span className="cell-sub">⚠ {m.transfer_note}</span> : null}
                <span className="cell-sub">
                  Orden {m.sort_order} · {m.requests_count} solicitud(es)
                  {m.has_qr_image ? ' · con QR' : ' · sin QR'}
                </span>
              </div>
              {m.has_qr_image ? (
                <img
                  src={`${API}/admin/payment-methods/${m.id}/qr?v=${m.id}`}
                  alt={`QR de ${m.bank_name}`}
                  className="payment-qr-thumb"
                />
              ) : null}
              <div className="row-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal(m)}>Editar</button>
                <button
                  type="button"
                  className={`btn btn-sm ${m.is_active ? 'btn-danger' : 'btn-primary'}`}
                  onClick={() => toggleMethod(m)}
                >
                  {m.is_active ? 'Desactivar' : 'Activar'}
                </button>
                {!m.requests_count ? (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => removeMethod(m)}>
                    Eliminar
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn btn-ghost" style={{ marginBottom: 18 }} onClick={() => setModal('new')}>
        + Agregar banco / método de pago
      </button>

      <form onSubmit={saveSettings} className="modal-form" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <label className="field">
          <span>Mensaje para compradores (se muestra sobre los métodos de pago)</span>
          <textarea
            value={settings.buyer_message}
            onChange={(e) => setSettings((s) => ({ ...s, buyer_message: e.target.value }))}
            rows={2}
            maxLength={500}
            placeholder="Ej. Transfiere el valor de tu entrada a cualquiera de estas cuentas y sube el comprobante."
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={settings.public_sales_enabled}
            onChange={(e) => setSettings((s) => ({ ...s, public_sales_enabled: e.target.checked }))}
          />
          <span>Activar venta pública (requiere al menos un método activo)</span>
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar venta web'}
        </button>
      </form>

      {modal ? (
        <MethodForm
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      ) : null}
    </div>
  );
}
