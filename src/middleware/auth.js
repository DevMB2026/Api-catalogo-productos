const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

// Verifica el token Bearer y coloca req.user = { id, role }.
exports.protect = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'NO_TOKEN', 'Falta el token de autenticación (header Authorization: Bearer ...)'));
  if (!process.env.JWT_SECRET) return next(new AppError(500, 'JWT_NOT_CONFIGURED', 'JWT_SECRET no está configurado en el servidor'));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (e) {
    next(new AppError(401, 'INVALID_TOKEN', 'Token inválido o expirado'));
  }
};

// Variante NO bloqueante de protect: si hay un JWT válido lo decodifica y
// coloca req.user; si no hay token, o es inválido/expirado, sigue sin error
// (queda anónimo). Para rutas que son PÚBLICAS pero quieren dar más contexto
// cuando quien pregunta resulta ser el admin (ej. mostrar precioDistribuidor
// al admin en la edición, sin exigirle autenticarse para leer el catálogo).
exports.protectOptional = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !process.env.JWT_SECRET) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
  } catch (e) { /* token inválido/expirado: se ignora, sigue anónimo */ }
  next();
};

// Exige rol de administrador (usar siempre después de protect).
exports.requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError(403, 'FORBIDDEN', 'Se requiere rol de administrador'));
  }
  next();
};
