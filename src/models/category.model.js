const mongoose = require('mongoose');
const slugify = require('slugify');

// Vínculo categoría → definición de atributo permitido. `required` marca si el
// atributo es obligatorio para los productos de esta categoría.
const categoryAttrDefSchema = new mongoose.Schema({
  attribute: { type: mongoose.Schema.Types.ObjectId, ref: 'AttributeDefinition', required: true },
  required: { type: Boolean, default: false },
  orden: { type: Number, default: 0 }
}, { _id: false });

// Categoría del catálogo (Playeras, Chamarras, Pantalones...).
// El campo `parent` cubre la relación Categoría → Subcategoría sin necesidad
// de una segunda colección: parent = null → categoría raíz; con valor → subcategoría.
const categorySchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  orden: { type: Number, default: 0 }, // para ordenar en menús
  activo: { type: Boolean, default: true },
  // Atributos permitidos para los productos de esta categoría. Los del padre se
  // heredan al resolver el formulario (se combinan en la capa de servicio).
  attributeDefs: { type: [categoryAttrDefSchema], default: [] }
}, { timestamps: true });

categorySchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Category', categorySchema);
