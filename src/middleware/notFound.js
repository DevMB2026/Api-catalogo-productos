const AppError = require('../utils/AppError');

// Se ejecuta cuando ninguna ruta coincidió: entrega un 404 uniforme.
module.exports = (req, res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.originalUrl}`));
};
