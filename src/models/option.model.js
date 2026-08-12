const mongoose = require('mongoose');
const slugify = require('slugify');

// Eje de variación (ej. "Color", "Talla"). Sus valores viven en OptionValue.
const optionSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  tipo: { type: String, enum: ['swatch', 'size', 'text'], default: 'text' }, // pista para la UI
  orden: { type: Number, default: 0 },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

optionSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Option', optionSchema);
