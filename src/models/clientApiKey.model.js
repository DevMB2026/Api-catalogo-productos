const mongoose = require('mongoose');

// Llave de acceso PROGRAMÁTICO para clientes con acceso a precios (usuarios
// role:'usuario' con pricePermissions). Colección SEPARADA de ApiKey
// (distribuidores) a propósito: apiKeyAuth solo busca en `apikeys` y
// clientKeyAuth solo en `clientapikeys`, así que una llave de distribuidor
// nunca da precios y una llave de cliente nunca entra a los endpoints de
// distribuidor. Solo se guarda el HASH; la llave en claro se muestra una
// única vez al generarla (igual que ApiKey y las contraseñas).
const clientApiKeySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  hash: { type: String, required: true, unique: true, index: true }, // sha256 de la llave real
  prefijo: { type: String, required: true }, // ej. "cli_a1b2c3d4…" — solo para identificarla en UI/logs
  activo: { type: Boolean, default: true },
  ultimoUso: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('ClientApiKey', clientApiKeySchema);
