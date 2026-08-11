const Product = require('../models/product.model');
const Brand = require('../models/brand.model');
const Category = require('../models/category.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateUniqueSlug } = require('../utils/slug');
const { uploadBuffer, destroy, ensureConfigured } = require('../services/cloudinary.service');

// Añade los datos legibles de marca/categoría en vez de solo el ObjectId.
const withRefs = (query) => query
  .populate('brand', 'nombre slug')
  .populate('category', 'nombre slug')
  .populate('subcategory', 'nombre slug');

// GET /api/v1/products  — filtros + búsqueda + paginación + orden
exports.list = asyncHandler(async (req, res) => {
  const { brand, category, subcategory, linea, sexo, color, talla, aplicacion, activo, sku, slug, q } = req.query;
  const filtro = {};

  // Por defecto solo activos; ?activo=false o ?activo=all para lo demás.
  if (activo === undefined) filtro.activo = true;
  else if (activo !== 'all') filtro.activo = activo === 'true';

  // Marca/categoría/subcategoría llegan como SLUG y se resuelven a su _id.
  if (brand) {
    const b = await Brand.findOne({ slug: brand.toLowerCase() }).select('_id');
    filtro.brand = b ? b._id : null; // sin coincidencia => no devuelve nada
  }
  if (category) {
    const c = await Category.findOne({ slug: category.toLowerCase() }).select('_id');
    filtro.category = c ? c._id : null;
  }
  if (subcategory) {
    const s = await Category.findOne({ slug: subcategory.toLowerCase() }).select('_id');
    filtro.subcategory = s ? s._id : null;
  }

  if (linea) filtro.linea = linea;
  if (sexo) filtro.sexo = sexo;
  if (color) filtro['variants.color'] = color;      // color vive dentro de la variante
  if (talla) filtro['variants.tallas'] = talla;     // talla también
  if (aplicacion) filtro.aplicaciones = aplicacion; // "¿qué productos aceptan bordado?"
  if (sku) filtro.sku = sku.toUpperCase();
  if (slug) filtro.slug = slug.toLowerCase();
  if (q) filtro.$text = { $search: q };

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  // Orden: por relevancia si hay búsqueda de texto; si no, ?sort=campo,-otro; default -createdAt.
  let sort = { createdAt: -1 };
  if (q) sort = { score: { $meta: 'textScore' } };
  if (req.query.sort) {
    sort = {};
    for (const part of req.query.sort.split(',')) {
      if (!part) continue;
      sort[part.replace(/^-/, '')] = part.startsWith('-') ? -1 : 1;
    }
  }

  let query = Product.find(filtro);
  if (q) query = query.select({ score: { $meta: 'textScore' } });
  query = withRefs(query).sort(sort).skip(skip).limit(limit);

  const [data, total] = await Promise.all([query, Product.countDocuments(filtro)]);

  res.json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

// GET /api/v1/products/:id
exports.getById = asyncHandler(async (req, res) => {
  const product = await withRefs(Product.findById(req.params.id));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, data: product });
});

// GET /api/v1/products/slug/:slug
exports.getBySlug = asyncHandler(async (req, res) => {
  const product = await withRefs(Product.findOne({ slug: req.params.slug.toLowerCase() }));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, data: product });
});

// GET /api/v1/products/sku/:sku
exports.getBySku = asyncHandler(async (req, res) => {
  const product = await withRefs(Product.findOne({ sku: req.params.sku.toUpperCase() }));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, data: product });
});

// POST /api/v1/products   (TODO Etapa E: proteger con auth admin)
exports.create = asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (!data.slug && data.nombre) {
    data.slug = await generateUniqueSlug(Product, data.nombre);
  }
  const created = await Product.create(data);
  const full = await withRefs(Product.findById(created._id));
  res.status(201).json({ success: true, data: full });
});

// PATCH /api/v1/products/:id   (TODO Etapa E: proteger con auth admin)
exports.update = asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  if (updates.nombre && !updates.slug) {
    updates.slug = await generateUniqueSlug(Product, updates.nombre, req.params.id);
  }
  const product = await Product.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true
  });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});

// DELETE /api/v1/products/:id   — soft delete por defecto; ?hard=true borra físico
exports.remove = asyncHandler(async (req, res) => {
  if (req.query.hard === 'true') {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

    // Borra las imágenes en Cloudinary para no dejar huérfanas. Los public_id
    // placeholder de la migración (legacy/...) fallarán silenciosamente: se ignoran.
    const publicIds = product.variants
      .flatMap((v) => v.imagenes.map((im) => im.public_id))
      .filter(Boolean);
    for (const pid of publicIds) {
      try { await destroy(pid); } catch (e) { console.warn('No se pudo borrar en Cloudinary:', pid); }
    }

    await product.deleteOne();
    return res.json({ success: true, message: 'Producto eliminado permanentemente' });
  }
  const product = await Product.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, message: 'Producto desactivado (soft delete)', data: { _id: product._id, activo: product.activo } });
});

// POST /api/v1/products/:id/images   — sube imágenes a una variante (multipart)
// Campo de archivos: "imagenes". Variante destino: body.variantId o body.color;
// si el producto tiene una sola variante, se usa esa.  (TODO Etapa E: auth admin)
exports.addImages = asyncHandler(async (req, res) => {
  ensureConfigured();
  if (!req.files || req.files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'No se recibieron imágenes en el campo "imagenes"');
  }

  const product = await Product.findById(req.params.id).populate('brand', 'slug');
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  let variant;
  if (req.body.variantId) variant = product.variants.id(req.body.variantId);
  else if (req.body.color) variant = product.variants.find((v) => v.color.toLowerCase() === req.body.color.toLowerCase());
  else if (product.variants.length === 1) variant = product.variants[0];
  if (!variant) {
    throw new AppError(400, 'VARIANT_REQUIRED', 'Indica variantId o color: el producto tiene varias variantes');
  }

  const brandSlug = (product.brand && product.brand.slug) || 'sin-marca';
  const folder = `catalogo/${brandSlug}/${product.sku}`;
  const desde = variant.imagenes.length;
  for (let i = 0; i < req.files.length; i++) {
    const result = await uploadBuffer(req.files[i].buffer, folder);
    variant.imagenes.push({
      url: result.secure_url,
      public_id: result.public_id,
      orden: desde + i,
      principal: variant.imagenes.length === 0 // la primera imagen de la variante es principal
    });
  }

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.status(201).json({ success: true, data: full });
});

// DELETE /api/v1/products/:id/images?public_id=...   — borra una imagen concreta
// (el public_id lleva "/" así que va por query, no como parámetro de ruta).
exports.removeImage = asyncHandler(async (req, res) => {
  const publicId = req.query.public_id || (req.body && req.body.public_id);
  if (!publicId) throw new AppError(400, 'PUBLIC_ID_REQUIRED', 'Falta public_id (en query o body)');

  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  let encontrada = false;
  for (const variant of product.variants) {
    if (variant.imagenes.some((im) => im.public_id === publicId)) {
      variant.imagenes = variant.imagenes.filter((im) => im.public_id !== publicId);
      encontrada = true;
      break;
    }
  }
  if (!encontrada) throw new AppError(404, 'IMAGE_NOT_FOUND', 'La imagen no existe en este producto');

  try { await destroy(publicId); } catch (e) { console.warn('No se pudo borrar en Cloudinary:', publicId); }

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});
