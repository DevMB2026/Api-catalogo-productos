const AppError = require('../utils/AppError');

// Manejo de errores CENTRAL y uniforme. Traduce errores conocidos a respuestas
// estables { success, message, error:{ code } } y NUNCA filtra detalles internos
// (Mongo/Mongoose) al cliente: eso solo va a los logs del servidor (corrige I-5).
// Registra en consola: una línea discreta para errores esperados (4xx) y la
// traza completa solo para los inesperados (5xx), para no ensuciar el terminal.
function log(req, status, code, message) {
  const linea = `[${req.method} ${req.originalUrl}] ${status} ${code}${message ? ' — ' + message : ''}`;
  if (status >= 500) console.error(linea);
  else console.warn(linea);
}

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  // Errores que lanzamos a propósito.
  if (err instanceof AppError) {
    log(req, err.statusCode, err.code, err.message);
    if (err.statusCode >= 500) console.error(err); // detalle solo si es inesperado
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      error: { code: err.code, ...(err.details ? { fields: err.details } : {}) }
    });
  }

  // Validación de Mongoose.
  if (err.name === 'ValidationError') {
    log(req, 400, 'VALIDATION_ERROR');
    const fields = {};
    for (const [campo, detalle] of Object.entries(err.errors)) {
      fields[campo] = detalle.message;
    }
    return res.status(400).json({
      success: false,
      message: 'Datos inválidos',
      error: { code: 'VALIDATION_ERROR', fields }
    });
  }

  // ObjectId mal formado u otro casteo inválido.
  if (err.name === 'CastError') {
    log(req, 400, 'INVALID_ID');
    return res.status(400).json({
      success: false,
      message: `Valor inválido para el campo "${err.path}"`,
      error: { code: 'INVALID_ID' }
    });
  }

  // Error de Multer (tamaño excedido, campo inesperado, etc.).
  if (err.name === 'MulterError') {
    log(req, 400, 'UPLOAD_ERROR', err.code);
    return res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera el tamaño máximo (5 MB)' : 'Error al subir el archivo',
      error: { code: 'UPLOAD_ERROR', detail: err.code }
    });
  }

  // Clave duplicada (índice único: sku, slug...).
  if (err.code === 11000) {
    const campo = Object.keys(err.keyValue || {})[0] || 'campo';
    log(req, 409, 'DUPLICATE', campo);
    return res.status(409).json({
      success: false,
      message: `Ya existe un registro con ese ${campo}`,
      error: { code: 'DUPLICATE', field: campo }
    });
  }

  // Cualquier otro: error inesperado. Traza completa en el servidor.
  console.error(`[${req.method} ${req.originalUrl}] 500 INTERNAL_ERROR`, err);
  return res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    error: { code: 'INTERNAL_ERROR' }
  });
};
