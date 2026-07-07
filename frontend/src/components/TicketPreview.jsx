import React from 'react';
import { TICKET_COLORS } from '../components.jsx';

// QR de muestra (apunta al dominio del evento, no a una entrada real).
// El QR real solo existe en el PDF/correo: el token jamás viaja al navegador.
const SAMPLE_QR_PATH = 'M0 0.5h7m3 0h1m1 0h1m1 0h1m1 0h1m1 0h3m1 0h7M0 1.5h1m5 0h1m1 0h1m1 0h1m3 0h3m1 0h1m3 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m5 0h1m1 0h1m1 0h1m2 0h1m2 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m1 0h3m1 0h3m2 0h1m2 0h1m1 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m2 0h1m6 0h1m2 0h2m1 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m1 0h2m1 0h2m1 0h2m1 0h1m4 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M9 7.5h3m3 0h2m1 0h1m1 0h1M0 8.5h5m1 0h4m1 0h1m5 0h1m2 0h2m1 0h1m1 0h1m1 0h1M0 9.5h2m1 0h1m6 0h1m1 0h2m2 0h5m1 0h3m3 0h1M3 10.5h4m3 0h1m2 0h4m1 0h1m1 0h2m1 0h1M1 11.5h2m2 0h1m1 0h2m3 0h2m5 0h1m2 0h4m1 0h1M0 12.5h1m2 0h2m1 0h5m1 0h1m1 0h2m1 0h1m2 0h1m4 0h2M2 13.5h2m12 0h1m1 0h7m3 0h1M1 14.5h1m1 0h1m2 0h1m1 0h1m1 0h3m2 0h1m2 0h1m1 0h1m2 0h4M0 15.5h4m1 0h1m1 0h2m1 0h2m2 0h1m1 0h1m4 0h2m1 0h1m2 0h1M4 16.5h1m1 0h2m1 0h3m5 0h1m7 0h2M0 17.5h1m1 0h1m1 0h2m1 0h2m1 0h1m1 0h3m4 0h6m1 0h1m1 0h1M0 18.5h1m3 0h4m5 0h6m5 0h1m1 0h1M0 19.5h1m4 0h1m2 0h2m2 0h2m2 0h1m2 0h2m2 0h1m3 0h1M0 20.5h1m2 0h2m1 0h3m3 0h1m1 0h1m2 0h1m1 0h6m1 0h3M8 21.5h1m1 0h1m5 0h1m3 0h1m3 0h5M0 22.5h7m1 0h1m2 0h2m2 0h2m2 0h2m1 0h1m1 0h3M0 23.5h1m5 0h1m3 0h2m2 0h2m2 0h1m1 0h1m3 0h1m2 0h2M0 24.5h1m1 0h3m1 0h1m1 0h4m5 0h1m2 0h5m1 0h1M0 25.5h1m1 0h3m1 0h1m1 0h2m2 0h3m1 0h1m8 0h4M0 26.5h1m1 0h3m1 0h1m1 0h3m2 0h3m3 0h1m2 0h6M0 27.5h1m5 0h1m1 0h2m2 0h2m1 0h2m2 0h3m3 0h1m1 0h1M0 28.5h7m1 0h1m1 0h1m1 0h1m1 0h2m1 0h1m1 0h1m2 0h3m1 0h1';

function SampleQr() {
  return (
    <svg viewBox="0 0 29 29" shapeRendering="crispEdges" className="tkp-qr-svg" aria-hidden="true">
      <path fill="#ffffff" d="M0 0h29v29H0z" />
      <path stroke="#0a0a0a" d={SAMPLE_QR_PATH} />
    </svg>
  );
}

// Banderines cruzados del logo FLAGS FEST (traza el color del ticket).
function FlagsIcon() {
  return (
    <svg viewBox="0 0 64 40" className="tkp-flags-icon" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round">
        <path d="M35 38 L22 6" />
        <path d="M29 38 L42 6" />
      </g>
      <g fill="currentColor">
        <path d="M22 6 L4 10 L20 16 Z" />
        <path d="M42 6 L60 10 L44 16 Z" />
      </g>
    </svg>
  );
}

// Estado neutro antes de elegir color: usa el rosa de la marca.
const NEUTRAL = {
  hex: '#ff2d78',
  soft: '#ff9dc2',
  darkBg: '#16060d',
  midBg: '#3d0b20',
};

/**
 * Vista previa de la entrada, tipo pulsera horizontal (misma estética que
 * el PDF y assets/referencias/formato-entrada.png). Escala completa con
 * container queries: todas las medidas internas van en cqw.
 *
 * Props: color (verde|rojo|amarillo|''), name, number (correlativo),
 * code (FF-0001 tras la venta), eventName, eventDate (texto ya formateado),
 * eventLocation, generated (true cuando la entrada ya fue emitida).
 */
export default function TicketPreview({
  color, name, number, code, eventName, eventDate, eventLocation, generated = false,
}) {
  const c = TICKET_COLORS[color] || null;
  const pal = c || NEUTRAL;
  const vars = {
    '--tk': pal.hex,
    '--tk-soft': pal.soft,
    '--tk-dark': pal.darkBg,
    '--tk-mid': pal.midBg,
  };
  const numberText = `Nº ${String(number || 0).padStart(4, '0')}`;

  return (
    <div className="tkp-wrap" style={vars}>
      <div className={`tkp${c ? '' : ' tkp-neutral'}`}>
        <div className="tkp-stub" aria-hidden="true">
          <span>{numberText}</span>
        </div>

        <div className="tkp-logo">
          <FlagsIcon />
          <span className="tkp-flags">FLAGS</span>
          <span className="tkp-fest">— FEST —</span>
          <span className="tkp-party">
            <em className="tkp-g">GREEN FLAGS</em>
            {' & '}
            <em className="tkp-r">RED FLAGS</em>
            {' PARTY'}
          </span>
          <span className="tkp-when">
            {[eventDate, eventLocation].filter(Boolean).join('  ·  ') || 'Fecha y lugar por definir'}
          </span>
        </div>

        <div className="tkp-center">
          <span className="tkp-color-label">{c ? c.label.toUpperCase() : 'TU COLOR'}</span>
          <span className="tkp-concept">{c ? c.concept : 'Elige un color'}</span>
          <span className="tkp-underline" />
          <span className={`tkp-name${name && name.trim() ? '' : ' tkp-placeholder'}`}>
            {name && name.trim() ? name.trim() : 'Nombre del asistente'}
          </span>
          <span className="tkp-phrase">“{c ? c.phrase : 'Elige tu color, vive la noche.'}”</span>
        </div>

        <div className="tkp-qr">
          <div className="tkp-qr-card">
            <SampleQr />
            {!generated ? <span className="tkp-qr-tag">MUESTRA</span> : null}
          </div>
          <span className="tkp-code">{code || numberText}</span>
          <span className="tkp-qr-note">
            {generated ? 'QR REAL EN EL PDF ENVIADO' : 'PRESENTAR ESTE CÓDIGO QR EL DÍA DEL EVENTO'}
          </span>
        </div>

        <div className="tkp-footer">
          <span className="tkp-footer-brand">{(eventName || 'FLAGS FEST').toUpperCase()}</span>
          <span className="tkp-footer-unique">ENTRADA ÚNICA E INTRANSFERIBLE</span>
          <span className="tkp-footer-scan">PRESENTAR ESTE CÓDIGO QR EL DÍA DEL EVENTO</span>
        </div>
      </div>
    </div>
  );
}
