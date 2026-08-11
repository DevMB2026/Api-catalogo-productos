const rateLimit = require('express-rate-limit');

// Límite general para toda la API.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas peticiones, intenta más tarde', error: { code: 'RATE_LIMITED' } }
});

// Límite estricto para el login (mitiga fuerza bruta).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiados intentos de acceso, intenta más tarde', error: { code: 'RATE_LIMITED' } }
});

module.exports = { apiLimiter, authLimiter };
