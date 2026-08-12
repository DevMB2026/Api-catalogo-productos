const mongoose = require('mongoose');
const slugify = require('slugify');

// Opción de un atributo select/multiselect.
const attrOptionSchema = new mongoose.Schema({
  value: { type: String, required: true, trim: true },
  label: { type: String, trim: true }
}, { _id: false });

// Definición de un atributo tipado y reutilizable. Es la pieza que permite
// crear atributos nuevos (ej. "Protección UV") sin tocar el código: la
// definición ES el dato.
const attributeDefinitionSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true }, // snake_case estable, ej. "proteccion_uv"
  label: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['text', 'number', 'boolean', 'select', 'multiselect'],
    required: true
  },
  unit: { type: String, trim: true }, // ej. "g/m²" para number
  options: { type: [attrOptionSchema], default: undefined }, // solo select/multiselect
  validation: {
    min: { type: Number },
    max: { type: Number },
    regex: { type: String },
    maxLength: { type: Number }
  },
  filterable: { type: Boolean, default: false }, // ¿se ofrece como filtro en el catálogo?
  group: { type: String, trim: true }, // agrupación en el formulario, ej. "Especificaciones"
  orden: { type: Number, default: 0 },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

attributeDefinitionSchema.pre('validate', function () {
  // Autogenera la key (snake_case) desde el label si no viene.
  if (!this.key && this.label) {
    this.key = slugify(this.label, { lower: true, strict: true, replacement: '_' });
  }
  // select/multiselect exigen al menos una opción.
  if (['select', 'multiselect'].includes(this.type) && (!this.options || this.options.length === 0)) {
    this.invalidate('options', 'Los tipos select y multiselect requieren al menos una opción');
  }
});

module.exports = mongoose.model('AttributeDefinition', attributeDefinitionSchema);
