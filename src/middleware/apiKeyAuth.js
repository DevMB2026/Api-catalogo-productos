const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const ApiKey = require('../models/apiKey.model');
const { hashKey } = require('../services/apiKey.service');

// Autentica peticiones de distribuidores vía header `X-API-Key` (credencial
// programática — distinta del JWT de admin, que es para el panel).
//
// Mensajes de error GENÉRICOS a propósito: nunca se revela si la key no
// existe, está inactiva, revocada, o si el usuario dueño fue desactivado —
// mismo principio que el login (no dar pistas a quien intenta adivinar).
// Cualquier error INESPERADO (ej. Mongo caído) NO se atrapa aquí: se deja
// propagar al errorHandler central (asyncHandler), que ya responde 500 sin
// filtrar detalles — así no se confunde una falla real de infraestructura
// con "key inválida" en los logs.
module.exports = asyncHandler(async (req, res, next) => {
  const raw = req.headers['x-api-key'];
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new AppError(401, 'API_KEY_REQUIRED', 'Falta la API Key (header X-API-Key)');
  }

  const hash = hashKey(raw.trim());
  const apiKey = await ApiKey.findOne({ hash }).populate('user', 'activo nombre email role catalogo');

  const valido = apiKey && apiKey.activo && !apiKey.revocada && apiKey.user && apiKey.user.activo;
  if (!valido) throw new AppError(401, 'API_KEY_INVALID', 'API Key inválida o inactiva');

  // catalogo viene del USUARIO (nunca de la petición): es la única fuente de
  // verdad de qué puede ver este distribuidor. null = sin restricción, igual
  // que el comportamiento de siempre.
  req.distribuidor = {
    userId: apiKey.user._id,
    apiKeyId: apiKey._id,
    nombre: apiKey.user.nombre,
    email: apiKey.user.email,
    catalogo: apiKey.user.catalogo || null
  };

  // "Fire and forget": NO se espera (sin await) — no debe retrasar la
  // respuesta al distribuidor, ni fallar la petición si esta escritura falla.
  ApiKey.updateOne({ _id: apiKey._id }, { ultimoUso: new Date() }).catch(() => {});

  next();
});
