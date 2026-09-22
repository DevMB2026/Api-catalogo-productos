const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const ClientApiKey = require('../models/clientApiKey.model');
const User = require('../models/user.model');
const { hashKey } = require('../services/apiKey.service');

// Autentica a un CLIENTE (usuario de precios) por header `X-API-Key` con su
// llave `cli_…`. Busca SOLO en clientapikeys (nunca en las llaves de
// distribuidor) y, como pricePermissions.js, relee la cuenta en Mongo en cada
// petición: desactivar al usuario, quitarle permisos o revocar la llave
// corta el acceso en la siguiente petición. Mensajes genéricos a propósito
// (no revelan si la llave existe, está revocada o la cuenta se desactivó).
module.exports = asyncHandler(async (req, res, next) => {
  const raw = req.headers['x-api-key'];
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new AppError(401, 'API_KEY_REQUIRED', 'Falta la API Key (header X-API-Key)');
  }

  const key = await ClientApiKey.findOne({ hash: hashKey(raw.trim()), activo: true }).select('user');
  const user = key && await User.findById(key.user).select('role activo pricePermissions nombre');
  if (!key || !user || !user.activo || user.role !== 'usuario') {
    throw new AppError(401, 'API_KEY_INVALID', 'API Key inválida o inactiva');
  }
  if (!user.pricePermissions || user.pricePermissions.length === 0) {
    throw new AppError(403, 'NO_PRICE_ACCESS', 'No tienes permisos de precio asignados.');
  }

  req.cliente = { userId: user._id, nombre: user.nombre, pricePermissions: user.pricePermissions };

  // Sin await: registrar el uso no debe retrasar ni tumbar la respuesta.
  ClientApiKey.updateOne({ _id: key._id }, { ultimoUso: new Date() }).catch(() => {});
  next();
});
