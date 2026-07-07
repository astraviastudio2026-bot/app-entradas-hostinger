// Identidad de cada color de entrada FLAGS FEST.
// Usada por el generador de PDF, el correo y las validaciones.
const COLOR_INFO = {
  verde: {
    key: 'verde',
    label: 'VERDE',
    concept: 'Soltero/a',
    description: 'Abierto/a a conocer a alguien especial',
    hex: '#2fd956',
    soft: '#8affa8',
    darkBg: '#04170a',
    midBg: '#0b3d1a',
  },
  rojo: {
    key: 'rojo',
    label: 'ROJO',
    concept: 'No busco nada',
    description: 'Disfruto la noche, sin etiquetas',
    hex: '#ff4040',
    soft: '#ff9d9d',
    darkBg: '#1b0404',
    midBg: '#521010',
  },
  amarillo: {
    key: 'amarillo',
    label: 'AMARILLO',
    concept: 'Depende',
    description: 'Todo puede pasar, déjate llevar',
    hex: '#ffc61a',
    soft: '#ffe38f',
    darkBg: '#191204',
    midBg: '#584108',
  },
};

const TAGLINE = 'Elige tu color, vive la noche';

// Moneda del evento (Ecuador usa USD)
const CURRENCY = process.env.CURRENCY_SYMBOL || '$';

module.exports = { COLOR_INFO, TAGLINE, CURRENCY };
