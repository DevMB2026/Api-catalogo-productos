const mongoose = require('mongoose');
const slugify = require('slugify');

// Una fila de la tabla: label (talla) + valores alineados con `columns`.
const sizeRowSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true }, // "M"
  values: { type: [Number], default: [] } // alineado con columns, ej. [52, 70, 44]
}, { _id: false });

// Tabla de medidas reutilizable: se define una vez y se asigna a muchos productos.
const sizeChartSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true }, // "Playera unisex estándar"
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  unidad: { type: String, enum: ['cm', 'in'], default: 'cm' },
  columns: { type: [String], default: [] }, // ["Pecho", "Largo", "Hombros"]
  rows: { type: [sizeRowSchema], default: [] },
  activo: { type: Boolean, default: true }
}, { timestamps: true });

sizeChartSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('SizeChart', sizeChartSchema);
