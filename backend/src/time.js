// Zona horaria del negocio: Ecuador (America/Guayaquil, UTC-5 fijo,
// sin horario de verano). La BD guarda todo en UTC (DATETIME).
const EC_OFFSET_HOURS = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

function toMysqlUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// 'YYYY-MM-DD' (día en Ecuador) -> inicio 00:00:00 EC expresado en UTC
function ecDayStartUtc(dateStr) {
  if (!DATE_RE.test(String(dateStr))) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(d.getUTCHours() + EC_OFFSET_HOURS);
  return toMysqlUtc(d);
}

// 'YYYY-MM-DD' (día en Ecuador) -> fin 23:59:59 EC expresado en UTC
function ecDayEndUtc(dateStr) {
  if (!DATE_RE.test(String(dateStr))) return null;
  const d = new Date(`${dateStr}T23:59:59Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(d.getUTCHours() + EC_OFFSET_HOURS);
  return toMysqlUtc(d);
}

// Fecha UTC -> texto legible en hora de Ecuador (dd/mm/aaaa HH:MM)
function formatEc(value, { withTime = true } = {}) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const ec = new Date(d.getTime() - EC_OFFSET_HOURS * 3600 * 1000);
  const date = `${pad(ec.getUTCDate())}/${pad(ec.getUTCMonth() + 1)}/${ec.getUTCFullYear()}`;
  if (!withTime) return date;
  return `${date} ${pad(ec.getUTCHours())}:${pad(ec.getUTCMinutes())}`;
}

// Normaliza el valor de una columna DATE a 'YYYY-MM-DD' SIN conversión
// de zona horaria: un DATE es un día fijo, no un instante. Acepta el
// string del driver ('2026-07-30'), un ISO serializado a medianoche o un
// Date leído como UTC. Devuelve null si no es una fecha reconocible.
function normalizeDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// 'YYYY-MM-DD' -> { year, month, day } numéricos (o null)
function parseDateOnly(value) {
  const s = normalizeDateOnly(value);
  if (!s) return null;
  const [year, month, day] = s.split('-').map(Number);
  return { year, month, day };
}

// 'YYYY-MM-DD' o Date de una columna DATE -> dd/mm/aaaa (sin conversión tz)
function formatDateOnly(value) {
  const s = normalizeDateOnly(value);
  if (!s) return '-';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

// Instante UTC (DATETIME) -> texto legible en hora de Ecuador.
// Alias explícito de formatEc: para fechas-hora reales, no columnas DATE.
const formatDateTimeLocal = formatEc;

module.exports = {
  ecDayStartUtc, ecDayEndUtc, formatEc, formatDateOnly, formatDateTimeLocal,
  normalizeDateOnly, parseDateOnly, toMysqlUtc, DATE_RE,
};
