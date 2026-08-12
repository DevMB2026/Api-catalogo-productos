const mongoose = require('mongoose');
const slugify = require('slugify');

// Valor de un eje (pool global compartido). Ej: Color→"Negro", Talla→"M".
// El producto elige un subconjunto de estos valores.
const optionValueSchema = new mongoose.Schema({
  option: { type: mongoose.Schema.Types.ObjectId, ref: 'Option', required: true, index: true },
  valor: { type: String, required: true, trim: true }, // "Negro", "M"
  slug: { type: String, lowercase: true, trim: true }, // "negro", "m" (para filtros)
  meta: { type: mongoose.Schema.Types.Mixed }, // ej. { hex: "#000000" } para swatches
  orden: { type: Number, default: 0 },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

// Único por (option, slug): "M" puede existir en Talla y en otra opción, pero
// no dos "M" dentro de Talla.
optionValueSchema.index({ option: 1, slug: 1 }, { unique: true });

optionValueSchema.pre('validate', function () {
  if (!this.slug && this.valor) {
    this.slug = slugify(this.valor, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('OptionValue', optionValueSchema);
