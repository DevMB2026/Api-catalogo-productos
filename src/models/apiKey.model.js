const mongoose = require('mongoose');

// Credencial de acceso PROGRAMÁTICO para distribuidores (distinta del JWT de
// admin: el JWT dice "quién eres" para el panel; la API Key dice "qué
// integración consume el catálogo"). Solo se guarda el HASH de la key real —
// igual que un password — la key en claro se muestra una única vez al
// crearla y no se puede recuperar después, solo regenerar.
const apiKeySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  hash: { type: String, required: true, unique: true, index: true }, // sha256 de la key real
  prefijo: { type: String, required: true }, // ej. "dist_a1b2c3d4…" — solo para identificarla en UI/logs
  nombre: { type: String, trim: true, default: 'Principal' },
  activo: { type: Boolean, default: true },
  revocada: { type: Boolean, default: false },
  ultimoUso: { type: Date },

  // Webhook de sincronización (plugin de WordPress del distribuidor): se
  // registra con esta misma API Key ya autenticada, así que no hay riesgo de
  // registro anónimo. webhookSecret se guarda en texto plano porque hace
  // falta para FIRMAR cada evento saliente (HMAC), no es una credencial de
  // login — mismo patrón que un webhook signing secret de Stripe.
  webhookUrl: { type: String, default: null },
  webhookSecret: { type: String, default: null, select: false },
  webhookActive: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('ApiKey', apiKeySchema);
