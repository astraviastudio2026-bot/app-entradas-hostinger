// Envuelve handlers async para que los errores lleguen al middleware global.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ah };
