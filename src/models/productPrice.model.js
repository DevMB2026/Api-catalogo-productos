const mongoose = require('mongoose');
const { Schema } = mongoose;

// Precios privados de un producto — colección SEPARADA de Product a propósito:
// los endpoints públicos y el namespace de distribuidor (X-API-Key) reutilizan
// los mismos controllers/populate de siempre y NUNCA hacen lookup hacia aquí,
// así que no existe ningún campo de precio que un select/populate descuidado
// pueda filtrar por error. Solo la tocan los endpoints admin (escritura) y los
// endpoints privados de precio (lectura, JWT + permiso).
//
// Un precio en null significa "todavía no definido" (no 0) — el admin puede
// dejar un tipo de precio sin capturar sin que se interprete como gratis.
//
// Precio a nivel PRODUCTO (no por variante): así el admin no repite los 5
// precios por cada color/talla. Un override por variante puntual es una
// posible fase futura, no forma parte de este modelo todavía.
//
// Niveles: menudeo, mayoreo y volumen son por CANTIDAD (en Prezenza: 1–30,
// 31–200 y 201 o más piezas). distribuidor y master son precios especiales,
// no dependen de la cantidad.
const productPriceSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, unique: true, index: true },

  menudeo: { type: Number, min: 0, default: null },
  mayoreo: { type: Number, min: 0, default: null },
  volumen: { type: Number, min: 0, default: null },
  distribuidor: { type: Number, min: 0, default: null },
  master: { type: Number, min: 0, default: null },

  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('ProductPrice', productPriceSchema);
