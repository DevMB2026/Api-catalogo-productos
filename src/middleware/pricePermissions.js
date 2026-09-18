const User = require('../models/user.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Exige que el usuario (ya autenticado por `protect`) tenga acceso al
// sistema de precios. A diferencia de requireAdmin, esto SIEMPRE vuelve a
// consultar Mongo — nunca confía en lo que diga el JWT — porque un permiso
// quitado o una cuenta desactivada debe bloquear el acceso en la SIGUIENTE
// petición, no esperar a que expire el token (hasta 7 días).
//
// El rol (admin/distribuidor/usuario) NUNCA se usa aquí para decidir nada:
// la única fuente de verdad es pricePermissions. Un admin o un distribuidor
// sin pricePermissions asignados queda bloqueado exactamente igual que
// cualquier otro usuario.
module.exports = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('activo pricePermissions');

  if (!user || !user.activo) {
    return next(new AppError(401, 'ACCOUNT_INACTIVE', 'Tu cuenta ya no tiene acceso. Contacta al administrador.'));
  }
  if (!user.pricePermissions || user.pricePermissions.length === 0) {
    return next(new AppError(403, 'NO_PRICE_ACCESS', 'No tienes permisos de precio asignados.'));
  }

  req.pricePermissions = user.pricePermissions;
  next();
});
