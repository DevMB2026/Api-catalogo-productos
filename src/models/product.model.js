const mongoose = require('mongoose');
const slugify = require('slugify');

const { Schema } = mongoose;
const oid = (ref, extra = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

// ---------- Subdocumentos ----------

// Imagen. `optionValue` permite asociarla a un color/valor (imágenes por color).
const mediaSchema = new Schema({
  url: { type: String, required: true },
  public_id: { type: String, required: true }, // para borrar en Cloudinary
  alt: { type: String },
  orden: { type: Number, default: 0 },
  principal: { type: Boolean, default: false },
  tipo: { type: String, default: 'image' },
  optionValue: oid('OptionValue'), // opcional: imagen ligada a un valor (ej. color)
  // Para productos que combinan hombre+mujer: null/sin definir = la foto
  // sirve para cualquier género (comportamiento de siempre, sin filtrar);
  // 'hombre'/'mujer' = la foto solo se muestra cuando ese género está
  // seleccionado. Reemplaza al heurístico anterior por nombre de archivo,
  // que fallaba cuando el nombre traía ambas palabras a la vez.
  sexo: { type: String, enum: ['hombre', 'mujer'], default: null }
}, { _id: false });

// Valor de un atributo dinámico (EAV): definición + valor. El tipo del valor lo
// dicta la AttributeDefinition; se valida en la capa de servicio (Etapa 3).
const attributeValueSchema = new Schema({
  attribute: oid('AttributeDefinition', { required: true }),
  value: { type: Schema.Types.Mixed }
}, { _id: false });

// Eje usado por el producto + los valores disponibles para él (subconjunto del pool).
const productOptionSchema = new Schema({
  option: oid('Option', { required: true }),
  values: [oid('OptionValue')]
}, { _id: false });

// Variante: una combinación concreta de valores de opción (uno por eje).
// Mantiene _id para poder direccionarla desde los endpoints.
const variantSchema = new Schema({
  sku: { type: String, trim: true }, // único a nivel de app (no por índice, al ser embebido)
  optionValues: [oid('OptionValue')], // ej. [Negro, M]
  composicion: { type: String, trim: true }, // texto libre: "60% algodón, 40% poliéster"
  stock: { type: Number, default: 0, min: 0 }, // preparado para inventario
  media: [mediaSchema],
  activo: { type: Boolean, default: true }
});

const faqSchema = new Schema({
  pregunta: { type: String, required: true },
  respuesta: { type: String, required: true }
}, { _id: false });

// Alias de SKU: el MISMO producto (single source of truth) puede tener un SKU
// distinto en otro sitio/marca (ej. Fit Be Fresh usa TPLBFCRU-1 y Prezenza otro).
const skuAliasSchema = new Schema({
  sku: { type: String, required: true, uppercase: true, trim: true },
  brand: oid('Brand')
}, { _id: false });

// ---------- Producto ----------
const productSchema = new Schema({
  nombre: { type: String, required: true, trim: true },
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  descripcion: { type: String, trim: true },

  brand: oid('Brand', { required: true, index: true }), // marca PRINCIPAL (= brands[0]); se mantiene por compatibilidad
  brands: { type: [oid('Brand')], default: [] }, // TODAS las marcas donde aparece el producto (SSOT multi-marca)
  skuAliases: { type: [skuAliasSchema], default: [] }, // SKUs secundarios por sitio/marca
  category: oid('Category', { required: true, index: true }),
  // Público objetivo: uno o varios ("multi"). Mongoose castea un string viejo a
  // [string] al leer, así que los datos anteriores siguen funcionando.
  sexo: {
    type: [{ type: String, enum: ['hombre', 'mujer', 'unisex'] }],
    required: true,
    validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: 'Indica al menos un público' }
  },

  // --- Motor dinámico ---
  attributes: { type: [attributeValueSchema], default: [] }, // valores EAV
  features: [oid('Feature')],
  applications: [oid('Application')],
  options: { type: [productOptionSchema], default: [] }, // ejes + valores disponibles
  variants: { type: [variantSchema], default: [] }, // combinaciones generadas

  sizeChart: oid('SizeChart'), // tabla reutilizable (opcional) — usada cuando el producto no necesita distinguir por género
  // Para productos que combinan hombre+mujer con cortes/medidas distintos: si
  // ambas están asignadas, la ficha muestra la que corresponde al género que
  // el cliente tenga seleccionado (mismo selector que ya cambia color/talla).
  // Si solo se usa `sizeChart`, el comportamiento es igual que antes.
  sizeChartHombre: oid('SizeChart'),
  sizeChartMujer: oid('SizeChart'),
  faq: { type: [faqSchema], default: [] },
  media: { type: [mediaSchema], default: [] }, // galería a nivel producto

  destacado: { type: Boolean, default: false },
  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });

// ---------- Índices ----------
productSchema.index({ brand: 1, category: 1, activo: 1 });
productSchema.index({ brands: 1 });
productSchema.index({ 'skuAliases.sku': 1 });
productSchema.index({ 'attributes.attribute': 1, 'attributes.value': 1 }); // filtrado por atributo
productSchema.index({ features: 1 });
productSchema.index({ applications: 1 });
productSchema.index({ nombre: 'text', descripcion: 'text', sku: 'text' });
productSchema.index({ updatedAt: 1 }); // usado por GET /products/changes (sync incremental)

// ---------- Slug automático ----------
productSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
  // Mantén brands sincronizado: si viene vacío, siémbralo con la marca principal.
  if ((!this.brands || this.brands.length === 0) && this.brand) {
    this.brands = [this.brand];
  }
});

module.exports = mongoose.model('Product', productSchema);
