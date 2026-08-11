const AppError = require('../utils/AppError');

// Lista blanca de orígenes autorizados, desde ALLOWED_ORIGINS (separados por coma).
const parseOrigins = () => (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Permite herramientas sin cabecera Origin (curl, apps móviles, server-to-server).
    if (!origin) return callback(null, true);
    if (parseOrigins().includes(origin)) return callback(null, true);
    return callback(new AppError(403, 'CORS_NOT_ALLOWED', 'Origen no permitido por CORS'));
  }
};

module.exports = corsOptions;
