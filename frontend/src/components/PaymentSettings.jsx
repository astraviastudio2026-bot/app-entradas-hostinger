import React, { useEffect, useRef, useState } from 'react';
import { api, apiForm } from '../api';
import { Spinner, useToast } from '../components.jsx';

const API = import.meta.env.VITE_API_URL || '/api';

// Configuración de la venta web (datos de transferencia que ve el
// público en /comprar). Solo admin; vive dentro de la página Evento.
export default function PaymentSettings() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasQr, setHasQr] = useState(false);
  const [qrFile, setQrFile] = useState(null);
  const [removeQr, setRemoveQr] = useState(false);
  const [qrBust, setQrBust] = useState(0); // fuerza recarga de la imagen tras guardar
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    bank_name: '',
    account_type: '',
    account_number: '',
    account_holder: '',
    account_document: '',
    transfer_note: '',
    buyer_message: '',
    public_sales_enabled: false,
  });

  useEffect(() => {
    api('/admin/payment-settings')
      .then((d) => {
        if (d.settings) {
          setForm({
            bank_name: d.settings.bank_name || '',
            account_type: d.settings.account_type || '',
            account_number: d.settings.account_number || '',
            account_holder: d.settings.account_holder || '',
            account_document: d.settings.account_document || '',
            transfer_note: d.settings.transfer_note || '',
            buyer_message: d.settings.buyer_message || '',
            public_sales_enabled: Boolean(d.settings.public_sales_enabled),
          });
          setHasQr(Boolean(d.settings.has_qr_image));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

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
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'public_sales_enabled') fd.append(k, v ? '1' : '0');
        else fd.append(k, v);
      });
      if (qrFile) fd.append('qr_image', qrFile);
      if (removeQr && !qrFile) fd.append('remove_qr_image', '1');
      const d = await apiForm('/admin/payment-settings', fd);
      toast(d.message, 'success');
      setQrFile(null);
      setRemoveQr(false);
      if (fileRef.current) fileRef.current.value = '';
      setHasQr(Boolean(qrFile) || (hasQr && !removeQr));
      setQrBust(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className="panel"><Spinner text="Cargando venta web…" /></div>;

  return (
    <form onSubmit={submit} className="panel modal-form payment-settings">
      <div className="panel-head">
        <h3>Venta web · datos de transferencia</h3>
        <span className={`status-badge ${form.public_sales_enabled ? 'status-approved' : 'status-rejected'}`}>
          {form.public_sales_enabled ? 'ACTIVA' : 'DESACTIVADA'}
        </span>
      </div>
      <p className="cell-sub" style={{ margin: 0 }}>
        Estos datos se muestran al público en <a href="/comprar" target="_blank" rel="noreferrer" className="link">/comprar ↗</a>.
        Las solicitudes llegan a la sección <strong>Compras web</strong> y la entrada se genera solo al aprobar el pago.
      </p>

      <div className="form-row">
        <label className="field">
          <span>Banco</span>
          <input value={form.bank_name} onChange={set('bank_name')} maxLength={120} placeholder="Banco Pichincha" />
        </label>
        <label className="field">
          <span>Tipo de cuenta</span>
          <input value={form.account_type} onChange={set('account_type')} maxLength={60} placeholder="Ahorros" />
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Número de cuenta</span>
          <input value={form.account_number} onChange={set('account_number')} maxLength={60} placeholder="2200XXXXXX" />
        </label>
        <label className="field">
          <span>Titular de la cuenta</span>
          <input value={form.account_holder} onChange={set('account_holder')} maxLength={120} placeholder="Nombre del titular" />
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Cédula / RUC del titular</span>
          <input value={form.account_document} onChange={set('account_document')} maxLength={30} />
        </label>
        <label className="field">
          <span>Nota para la transferencia</span>
          <input
            value={form.transfer_note}
            onChange={set('transfer_note')}
            maxLength={300}
            placeholder="Ej. envía el valor exacto y conserva tu comprobante"
          />
        </label>
      </div>
      <label className="field">
        <span>Mensaje para compradores (se muestra sobre los datos bancarios)</span>
        <textarea
          value={form.buyer_message}
          onChange={set('buyer_message')}
          rows={2}
          maxLength={500}
          placeholder="Ej. Transfiere el valor de tu entrada y sube el comprobante. Validamos pagos todos los días."
        />
      </label>

      <label className="field">
        <span>Imagen QR de pago (opcional · JPG/PNG/WEBP, máx. 2 MB)</span>
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          onChange={(e) => { setQrFile(e.target.files?.[0] || null); setRemoveQr(false); }}
        />
      </label>
      {hasQr && !qrFile ? (
        <div className="payment-qr-row">
          <img src={`${API}/public/payment-qr?v=${qrBust}`} alt="QR de pago actual" className="payment-qr-thumb" />
          <label className="check-field">
            <input type="checkbox" checked={removeQr} onChange={(e) => setRemoveQr(e.target.checked)} />
            <span>Quitar la imagen QR actual</span>
          </label>
        </div>
      ) : null}

      <label className="check-field">
        <input type="checkbox" checked={form.public_sales_enabled} onChange={set('public_sales_enabled')} />
        <span>Activar venta pública (requiere banco, cuenta y titular)</span>
      </label>

      {error ? <div className="form-error">{error}</div> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar venta web'}
      </button>
    </form>
  );
}
