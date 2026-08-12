const mongoose = require('mongoose');
const slugify = require('slugify');

// Característica / insignia de presencia (sí-no), con ícono opcional.
// Ej: "Cinta reflejante 3M", "Costuras reforzadas". El producto referencia
// un subconjunto (relación N:M).
const featureSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  icono: { type: String, trim: true }, // nombre de ícono o URL
  descripcion: { type: String, trim: true },
  orden: { type: Number, default: 0 },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

featureSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Feature', featureSchema);
