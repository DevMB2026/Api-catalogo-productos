const AppError = require('../utils/AppError');

// Valida req[source] contra un esquema Zod. Si falla, responde 400 con el
// detalle por campo. Si pasa, reemplaza req[source] por los datos ya parseados
// (Zod descarta claves desconocidas, así que también sanea la entrada).
// Nota: solo se usa con 'body' (en Express 5 req.query es de solo lectura).
module.exports = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return next(new AppError(400, 'VALIDATION_ERROR', 'Datos inválidos', fields));
  }
  req[source] = result.data;
  next();
};
