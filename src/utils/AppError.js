// Error operacional controlado: los que lanzamos a propósito (404, 400, etc.)
// con un código estable que el cliente puede interpretar. El middleware de
// errores lo distingue de los errores inesperados para no filtrar detalles.
class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details; // p. ej. { campo: 'mensaje' } de validación
    this.isOperational = true;
  }
}

module.exports = AppError;
