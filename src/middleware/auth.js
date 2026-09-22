const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/user.model');

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

// Exige rol de administrador (usar siempre después de protect). NO confía en
// el role del JWT: vuelve a leer la cuenta en Mongo en cada petición (mismo
// principio que pricePermissions.js), para que desactivar o cambiar de rol a
// un admin le quite el acceso en la siguiente petición, no hasta que expire
// el token (JWT_EXPIRES, hasta 7 días).
exports.requireAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Se requiere rol de administrador');
  }
  const user = await User.findById(req.user.id).select('role activo');
  if (!user || !user.activo) {
    throw new AppError(401, 'ACCOUNT_INACTIVE', 'Tu cuenta ya no tiene acceso. Contacta al administrador.');
  }
  if (user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Se requiere rol de administrador');
  }
  next();
});
