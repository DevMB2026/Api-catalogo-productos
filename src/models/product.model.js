const mongoose = require('mongoose');
const slugify = require('slugify');

// ---------- Subdocumentos (viven siempre junto al producto) ----------

// Imagen individual. public_id es imprescindible para poder borrarla en
// Cloudinary (Etapa D) y evitar imágenes huérfanas.
const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  public_id: { type: String, required: true },
  alt: { type: String },
  orden: { type: Number, default: 0 },
  principal: { type: Boolean, default: false } // imagen principal de la variante
}, { _id: false });

// Variación del producto: relaciona color ↔ tallas ↔ imágenes.
// Mantiene _id para poder direccionar una variante concreta desde los endpoints.
const variantSchema = new mongoose.Schema({
  sku: { type: String, trim: true }, // sku de la variante (opcional pero recomendado)
  color: { type: String, required: true, trim: true },
  composicion: { type: String, trim: true }, // tela de esta variante, ej: "100% algodón", "60% algodón 40% poliéster"
  tallas: [{ type: String, trim: true }], // ej: ["S","M","L","XL"]
  // Preparado para inventario futuro: `tallas` podrá migrar a
  // [{ talla, stock, disponible }] sin romper el resto del modelo.
  imagenes: [imageSchema],
  principal: { type: Boolean, default: false } // variante por defecto del producto
});

// Una fila de la tabla de medidas. `medidas` es un Map de números para dar
// flexibilidad por prenda (camisa: pecho/largo/manga; pantalón: cintura/cadera/largo)
// pero con seguridad de tipos (mejora sobre el Mixed anterior).
const medidaSchema = new mongoose.Schema({
  talla: { type: String, required: true, trim: true },
  medidas: { type: Map, of: Number } // ej: { pecho: 52, largo: 70, hombros: 44 } en cm
}, { _id: false });

const faqSchema = new mongoose.Schema({
  pregunta: { type: String, required: true },
  respuesta: { type: String, required: true }
}, { _id: false });

// ---------- Producto ----------
const productSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
  slug: { type: String, unique: true, index: true, lowercase: true, trim: true },
  descripcion: { type: String, trim: true },

  // Referencias (colecciones independientes) — reemplazan a los String/enum sueltos.
  brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true, index: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' }, // opcional; su parent = category
  linea: { type: String, trim: true }, // tag opcional: "Corporativa", "Outdoor"...

  sexo: {
    type: String,
    enum: ['hombre', 'mujer', 'unisex'],
    required: true
  },

  // Información de tela estructurada (lo consultable), texto libre solo en infoAdicional.
  tela: {
    material: { type: String, trim: true },     // "Algodón"
    composicion: { type: String, trim: true },  // "60% algodón, 40% poliéster"
    tipo: { type: String, trim: true },         // "Piqué"
    peso: { type: String, trim: true },         // "180 g/m²"
    cuidados: [{ type: String, trim: true }]    // ["No usar cloro", "Lavar en frío"]
  },

  aplicaciones: [{
    type: String,
    enum: ['bordado', 'dtf', 'vinil', 'sublimado']
  }],

  // Atributos opcionales y flexibles (Be Fresh Security y casos especiales),
  // sin ensuciar los productos que no los usan.
  // ej: { altaVisibilidad: true, cintaReflejante: true, tipoCinta: "..." }
  atributos: { type: Map, of: mongoose.Schema.Types.Mixed },

  variants: [variantSchema],

  sizeGuide: [medidaSchema], // tabla de medidas
  faq: [faqSchema],          // preguntas frecuentes
  infoAdicional: { type: String, trim: true }, // texto libre no estructurado

  destacado: { type: Boolean, default: false },
  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });

// ---------- Índices ----------
// Filtro más común de la API: marca + categoría + activo.
productSchema.index({ brand: 1, category: 1, activo: 1 });
// Consultas del tipo "¿qué productos aceptan bordado?".
productSchema.index({ aplicaciones: 1 });
// Búsqueda de texto por nombre, descripción y SKU.
productSchema.index({ nombre: 'text', descripcion: 'text', sku: 'text' });

// ---------- Slug automático ----------
// Genera el slug a partir del nombre si no viene dado. La unicidad la garantiza
// el índice único; el controlador (Etapa C) resolverá colisiones añadiendo sufijo.
productSchema.pre('validate', function () {
  if (!this.slug && this.nombre) {
    this.slug = slugify(this.nombre, { lower: true, strict: true, trim: true });
  }
});

module.exports = mongoose.model('Product', productSchema);
