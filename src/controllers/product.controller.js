const Product = require('../models/product.model');
const Brand = require('../models/brand.model');
const Category = require('../models/category.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateUniqueSlug } = require('../utils/slug');
const { uploadBuffer, destroy, ensureConfigured } = require('../services/cloudinary.service');
const { validateProductDynamic } = require('../services/productValidation.service');

// Populate profundo para el detalle (todo lo que el catálogo/panel necesita).
const withRefs = (query) => query
  .populate('brand', 'nombre slug')
  .populate('brands', 'nombre slug')
  .populate('skuAliases.brand', 'nombre slug')
  .populate('category', 'nombre slug')
  .populate('attributes.attribute')
  .populate('features')
  .populate('applications')
  .populate('options.option')
  .populate('options.values')
  .populate('variants.optionValues')
  .populate('sizeChart');

// Populate ligero para el listado.
const withRefsLite = (query) => query
  .populate('brand', 'nombre slug')
  .populate('brands', 'nombre slug')
  .populate('category', 'nombre slug');

// Quita precioDistribuidor del objeto de respuesta salvo que la petición sea
// (a) de un distribuidor autenticado (req.distribuidor, vía apiKeyAuth) o
// (b) del propio panel admin con JWT válido (req.user.role==='admin', vía
// protectOptional) — si no, el admin nunca vería el precio que él mismo
// configuró al volver a abrir el producto para editarlo. Se hace sobre el
// objeto ya obtenido, no vía .select() de Mongo, para no chocar con la
// proyección $meta de textScore que usa la búsqueda. precioPublico nunca se
// toca: es visible para cualquiera.
const ocultarPrecioDistribuidorSiAplica = (doc, req) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  const esAdmin = req.user && req.user.role === 'admin';
  if (!req.distribuidor && !esAdmin) delete obj.precioDistribuidor;
  return obj;
};

// GET /api/v1/products — filtros básicos + búsqueda + paginación
exports.list = asyncHandler(async (req, res) => {
  const { brand, brands, category, sexo, activo, sku, slug, q, destacado } = req.query;
  const filtro = {};

  if (activo === undefined) filtro.activo = true;
  else if (activo !== 'all') filtro.activo = activo === 'true';

  if (brands) {
    // Selección múltiple (ej. checkboxes del distribuidor en /distribuidor):
    // ?brands=marca-a,marca-b -> productos con AL MENOS UNA de esas marcas en
    // brands[]. A diferencia de ?brand=, una marca inexistente responde 400
    // explícito en vez de devolver silenciosamente una lista vacía.
    const slugsPedidos = [...new Set(String(brands).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
    if (slugsPedidos.length > 0) {
      const encontradas = await Brand.find({ slug: { $in: slugsPedidos } }).select('_id slug');
      const encontradasSet = new Set(encontradas.map((b) => b.slug));
      const invalidas = slugsPedidos.filter((s) => !encontradasSet.has(s));
      if (invalidas.length > 0) {
        throw new AppError(400, 'INVALID_BRAND', `Marca(s) no válida(s): ${invalidas.join(', ')}`, { brands: invalidas });
      }
      filtro.brands = { $in: encontradas.map((b) => b._id) };
    }
  } else if (brand) {
    // Filtra por MEMBRESÍA en brands[] (no solo la marca principal): así el
    // catálogo de una firma incluye también los productos multi-marca compartidos.
    const b = await Brand.findOne({ slug: brand.toLowerCase() }).select('_id');
    filtro.brands = b ? b._id : null;
  }
  if (category) {
    const c = await Category.findOne({ slug: category.toLowerCase() }).select('_id');
    filtro.category = c ? c._id : null;
  }
  if (sexo) filtro.sexo = sexo;
  if (destacado !== undefined) filtro.destacado = destacado === 'true';
  if (sku) filtro.sku = sku.toUpperCase();
  if (slug) filtro.slug = slug.toLowerCase();
  if (q) filtro.$text = { $search: q };

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

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
  query = withRefsLite(query).sort(sort).skip(skip).limit(limit);

  const [rows, total] = await Promise.all([query, Product.countDocuments(filtro)]);
  const data = rows.map((r) => ocultarPrecioDistribuidorSiAplica(r, req));
  res.json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

exports.getById = asyncHandler(async (req, res) => {
  const product = await withRefs(Product.findById(req.params.id));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, data: ocultarPrecioDistribuidorSiAplica(product, req) });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const product = await withRefs(Product.findOne({ slug: req.params.slug.toLowerCase() }));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, data: ocultarPrecioDistribuidorSiAplica(product, req) });
});

exports.getBySku = asyncHandler(async (req, res) => {
  const sku = req.params.sku.toUpperCase();
  // Matchea el SKU principal O cualquier alias (SKU secundario de otro sitio/marca).
  const product = await withRefs(Product.findOne({ $or: [{ sku }, { 'skuAliases.sku': sku }] }));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, data: ocultarPrecioDistribuidorSiAplica(product, req) });
});

// POST /api/v1/products  (admin) — Zod (forma) + validación dinámica (semántica)
exports.create = asyncHandler(async (req, res) => {
  await validateProductDynamic(req.body, { partial: false });
  const data = { ...req.body };
  if (!data.slug && data.nombre) data.slug = await generateUniqueSlug(Product, data.nombre);
  const created = await Product.create(data);
  const full = await withRefs(Product.findById(created._id));
  res.status(201).json({ success: true, data: full });
});

// PATCH /api/v1/products/:id  (admin)
// Se valida el ESTADO FINAL (existente + cambios), no solo el parche: así se
// resuelve el esquema por la categoría real y se detectan incoherencias
// (p. ej. una variante que quedaría usando un valor de opción ya no declarado).
exports.update = asyncHandler(async (req, res) => {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  const merged = { ...existing.toObject(), ...req.body };
  await validateProductDynamic(merged, { partial: false });

  const updates = { ...req.body };
  if (updates.nombre && !updates.slug) updates.slug = await generateUniqueSlug(Product, updates.nombre, req.params.id);
  const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});

// DELETE /api/v1/products/:id — soft por defecto; ?hard=true borra físico + Cloudinary
exports.remove = asyncHandler(async (req, res) => {
  if (req.query.hard === 'true') {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
    const publicIds = [
      ...product.media.map((m) => m.public_id),
      ...product.variants.flatMap((v) => v.media.map((m) => m.public_id))
    ].filter(Boolean);
    for (const pid of publicIds) {
      try { await destroy(pid); } catch { console.warn('No se pudo borrar en Cloudinary:', pid); }
    }
    await product.deleteOne();
    return res.json({ success: true, message: 'Producto eliminado permanentemente' });
  }
  const product = await Product.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  res.json({ success: true, message: 'Producto desactivado (soft delete)', data: { _id: product._id, activo: product.activo } });
});

// POST /api/v1/products/:id/images — sube a una variante (variantId) o a la
// galería del producto si no se indica variante.
exports.addImages = asyncHandler(async (req, res) => {
  ensureConfigured();
  if (!req.files || req.files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'No se recibieron imágenes en el campo "imagenes"');
  }
  const product = await Product.findById(req.params.id).populate('brand', 'slug');
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  let bucket = product.media; // galería del producto por defecto
  if (req.body.variantId) {
    const variant = product.variants.id(req.body.variantId);
    if (!variant) throw new AppError(400, 'VARIANT_NOT_FOUND', 'La variante indicada no existe');
    bucket = variant.media;
  }

  const brandSlug = (product.brand && product.brand.slug) || 'sin-marca';
  const folder = `catalogo/${brandSlug}/${product.sku}`;
  const desde = bucket.length;
  for (let i = 0; i < req.files.length; i++) {
    const result = await uploadBuffer(req.files[i].buffer, folder);
    bucket.push({
      url: result.secure_url,
      public_id: result.public_id,
      orden: desde + i,
      principal: desde === 0 && i === 0
    });
  }

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.status(201).json({ success: true, data: full });
});

// DELETE /api/v1/products/:id/images?public_id=... — busca en galería y en variantes
exports.removeImage = asyncHandler(async (req, res) => {
  const publicId = req.query.public_id || (req.body && req.body.public_id);
  if (!publicId) throw new AppError(400, 'PUBLIC_ID_REQUIRED', 'Falta public_id (en query o body)');

  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  let encontrada = false;
  if (product.media.some((m) => m.public_id === publicId)) {
    product.media = product.media.filter((m) => m.public_id !== publicId);
    encontrada = true;
  }
  if (!encontrada) {
    for (const variant of product.variants) {
      if (variant.media.some((m) => m.public_id === publicId)) {
        variant.media = variant.media.filter((m) => m.public_id !== publicId);
        encontrada = true;
        break;
      }
    }
  }
  if (!encontrada) throw new AppError(404, 'IMAGE_NOT_FOUND', 'La imagen no existe en este producto');

  try { await destroy(publicId); } catch { console.warn('No se pudo borrar en Cloudinary:', publicId); }

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});
