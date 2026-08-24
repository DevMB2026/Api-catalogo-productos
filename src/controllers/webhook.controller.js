const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiKey = require('../models/apiKey.model');

// POST /api/v1/distribuidores/productos/webhook  (X-API-Key, ya autenticado
// por apiKeyAuth). Registra la URL de callback del plugin y genera un
// secreto NUEVO cada vez que se registra — se devuelve una única vez en la
// respuesta, el plugin debe guardarlo localmente. Volver a registrar
// simplemente rota el secreto anterior (no hay "actualizar solo la URL" por
// separado: es más simple y no hay ningún caso de uso que lo necesite).
exports.register = asyncHandler(async (req, res) => {
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  await ApiKey.updateOne(
    { _id: req.distribuidor.apiKeyId },
    { webhookUrl: req.body.url, webhookSecret, webhookActive: true }
  );

  res.json({ success: true, data: { webhookSecret } });
});

// DELETE /api/v1/distribuidores/productos/webhook — desactiva el webhook
// (se llama al desactivar el plugin, best-effort). No borra webhookUrl para
// dejar rastro de cuál fue el último registrado.
exports.unregister = asyncHandler(async (req, res) => {
  await ApiKey.updateOne({ _id: req.distribuidor.apiKeyId }, { webhookActive: false });
  res.json({ success: true, message: 'Webhook desactivado' });
});
