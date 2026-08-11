const mongoose = require('mongoose');
const slugify = require('slugify');

// Marca / sitio web que consume el catálogo (FitBeFresh, Prezenza, etc.).
// Colección separada porque se comparte entre muchos productos, se administra
// por su cuenta y guarda metadata propia (dominio para CORS, logo, activo).
const brandSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  dominio: { type: String, trim: true }, // ej: "fitbefresh.com" (referencia de consumo/CORS)
  logo: {
    url: { type: String },
    public_id: { type: String }
  },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

// Genera el slug a partir del nombre si no viene dado.
brandSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Brand', brandSchema);
