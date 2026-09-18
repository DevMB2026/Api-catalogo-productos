const mongoose = require('mongoose');
const slugify = require('slugify');

// Etiqueta/insignia promocional para mostrar sobre la imagen del producto
// (ej. "New Arrival", "Últimas piezas", "Más vendido"). El producto
// referencia un subconjunto (relación N:M) — mismo patrón que Feature.
const badgeSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  orden: { type: Number, default: 0 },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

badgeSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Badge', badgeSchema);
