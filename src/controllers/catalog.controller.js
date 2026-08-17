const Catalog = require('../models/catalog.model');
const Brand = require('../models/brand.model');
const Product = require('../models/product.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateUniqueSlug } = require('../utils/slug');

const withRefs = (query) => query
  .populate('marcaPrincipal', 'nombre slug')
  .populate('productosAdicionales', 'nombre sku slug brand');

// GET /api/v1/catalogos — público, lista ligera (para que WordPress u otro
// consumidor pueda descubrir qué catálogos existen, sin necesitar admin).
// Incluye marcaPrincipal (poblada) y el CONTEO de adicionales — no la lista
// completa de IDs (eso es solo para el detalle admin) — no es información
// sensible, y le ahorra al panel admin una llamada extra por fila de tabla.
exports.list = asyncHandler(async (req, res) => {
  const filtro = {};
  if (req.query.activo === undefined) filtro.activo = true;
  else if (req.query.activo !== 'all') filtro.activo = req.query.activo === 'true';

  const catalogs = await Catalog.find(filtro)
    .select('nombre slug activo marcaPrincipal productosAdicionales')
    .populate('marcaPrincipal', 'nombre slug')
    .sort({ nombre: 1 });

  const data = catalogs.map((c) => ({
    _id: c._id,
    nombre: c.nombre,
    slug: c.slug,
    activo: c.activo,
    marcaPrincipal: c.marcaPrincipal || null,
    totalProductosAdicionales: (c.productosAdicionales || []).length
  }));

  res.json({ success: true, data });
});

// GET /api/v1/catalogos/:id — admin (detalle completo con populate).
exports.getById = asyncHandler(async (req, res) => {
  const catalog = await withRefs(Catalog.findById(req.params.id));
  if (!catalog) throw new AppError(404, 'CATALOG_NOT_FOUND', 'Catálogo no encontrado');
  res.json({ success: true, data: catalog });
});

// Valida que marcaPrincipal (si viene) y productosAdicionales (si vienen)
// referencien documentos reales — igual de estricto que el resto de la API.
async function validateRefs(body) {
  if (body.marcaPrincipal) {
    const existe = await Brand.exists({ _id: body.marcaPrincipal });
    if (!existe) throw new AppError(400, 'INVALID_BRAND', 'La marca principal indicada no existe');
  }
  if (body.productosAdicionales && body.productosAdicionales.length > 0) {
    const count = await Product.countDocuments({ _id: { $in: body.productosAdicionales } });
    if (count !== body.productosAdicionales.length) {
      throw new AppError(400, 'INVALID_PRODUCT', 'Uno o más productos adicionales no existen');
    }
  }
}

// POST /api/v1/catalogos — admin.
exports.create = asyncHandler(async (req, res) => {
  await validateRefs(req.body);
  const data = { ...req.body };
  if (!data.slug && data.nombre) data.slug = await generateUniqueSlug(Catalog, data.nombre);
  const created = await Catalog.create(data);
  const full = await withRefs(Catalog.findById(created._id));
  res.status(201).json({ success: true, data: full });
});

// PATCH /api/v1/catalogos/:id — admin.
exports.update = asyncHandler(async (req, res) => {
  await validateRefs(req.body);
  const updates = { ...req.body };
  if (updates.nombre && !updates.slug) updates.slug = await generateUniqueSlug(Catalog, updates.nombre, req.params.id);
  const catalog = await Catalog.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!catalog) throw new AppError(404, 'CATALOG_NOT_FOUND', 'Catálogo no encontrado');
  const full = await withRefs(Catalog.findById(catalog._id));
  res.json({ success: true, data: full });
});

// DELETE /api/v1/catalogos/:id — soft delete (activo:false), igual que Brand.
exports.remove = asyncHandler(async (req, res) => {
  const catalog = await Catalog.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
  if (!catalog) throw new AppError(404, 'CATALOG_NOT_FOUND', 'Catálogo no encontrado');
  res.json({ success: true, message: 'Catálogo desactivado (soft delete)', data: { _id: catalog._id, activo: catalog.activo } });
});
