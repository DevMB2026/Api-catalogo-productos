// Sanitización anti NoSQL-injection: elimina claves que empiezan con "$" o
// contienen ".", que son las que MongoDB interpreta como operadores/rutas.
// Se hace mutando los objetos EN SITIO (delete de claves), no reasignando
// req.query, porque en Express 5 req.query es de solo lectura.
function scrub(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }
    const value = obj[key];
    if (value && typeof value === 'object') scrub(value);
  }
}

module.exports = (req, res, next) => {
  scrub(req.body);
  scrub(req.params);
  if (req.query) scrub(req.query);
  next();
};
