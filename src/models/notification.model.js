const mongoose = require('mongoose');

const { Schema } = mongoose;

// Registro de un aviso enviado a distribuidores/equipo interno cuando un
// producto se desactiva o se queda sin stock. Guarda un snapshot de
// nombre/sku (no solo el ref) para que el historial siga siendo legible
// aunque el producto se borre después.
const notificationSchema = new Schema({
  evento: { type: String, enum: ['desactivado', 'agotado'], required: true },
  producto: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  productoNombre: { type: String, required: true },
  productoSku: { type: String, required: true },
  destinatarios: { type: [String], default: [] }, // emails a los que se intentó enviar
  enviadoOk: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
