const mongoose = require('mongoose');
const slugify = require('slugify');

// Catálogo de personalizaciones (bordado, DTF, vinil, sublimado, y las que
// se agreguen). Reemplaza el texto libre / enum fijo anterior.
const applicationSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  descripcion: { type: String, trim: true },
  icono: { type: String, trim: true },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

applicationSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Application', applicationSchema);
