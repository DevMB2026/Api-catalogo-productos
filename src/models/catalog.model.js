const mongoose = require('mongoose');
const slugify = require('slugify');

const { Schema } = mongoose;

// Representa "qué muestra un escaparate" (un sitio WordPress, el catálogo de
// un distribuidor, etc.) — SEPARADO de Brand/Product a propósito:
// marcaPrincipal + productosAdicionales es una decisión de CURADURÍA para
// ESTE catálogo, no una afirmación de que esos productos "son de" la marca
// principal. No toca brands[] de ningún producto.
const catalogSchema = new Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },

  // Incluye TODOS los productos donde brands[] contiene esta marca (misma
  // membresía que ya usa el filtro público ?brand=). Opcional: un catálogo
  // puede ser 100% curado a mano (útil para un distribuidor sin marca "home").
  marcaPrincipal: { type: Schema.Types.ObjectId, ref: 'Brand', default: null },

  // Productos puntuales de CUALQUIER otra marca, elegidos a mano.
  productosAdicionales: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },

  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });

catalogSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Catalog', catalogSchema);
