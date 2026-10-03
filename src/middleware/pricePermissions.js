const User = require('../models/user.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Exige que el usuario (ya autenticado por `protect`) tenga acceso al
// sistema de precios. A diferencia de requireAdmin, esto SIEMPRE vuelve a
// consultar Mongo — nunca confía en lo que diga el JWT — porque un permiso
// quitado o una cuenta desactivada debe bloquear el acceso en la SIGUIENTE
// petición, no esperar a que expire el token (hasta 7 días).
//
// Para distribuidores y usuarios, la única fuente de verdad es
// pricePermissions: sin permisos asignados quedan bloqueados.
// Excepción: un ADMINISTRADOR activo ve todos los tipos de precio (puede
// editarlos en el panel de todos modos), sin tener que asignárselos a mano a
// cada cuenta de administrador.
const TODOS = ['menudeo', 'mayoreo', 'volumen', 'distribuidor', 'master'];

module.exports = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('activo role pricePermissions');

  if (!user || !user.activo) {
    return next(new AppError(401, 'ACCOUNT_INACTIVE', 'Tu cuenta ya no tiene acceso. Contacta al administrador.'));
  }
  if (user.role === 'admin') {
    req.pricePermissions = TODOS;
    return next();
  }
  if (!user.pricePermissions || user.pricePermissions.length === 0) {
    return next(new AppError(403, 'NO_PRICE_ACCESS', 'No tienes permisos de precio asignados.'));
  }

  req.pricePermissions = user.pricePermissions;
  next();
});
