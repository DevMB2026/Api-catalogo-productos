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
  ultimoUso: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('ApiKey', apiKeySchema);
