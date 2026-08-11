const Brand = require('../models/brand.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateUniqueSlug } = require('../utils/slug');

// GET /api/v1/brands
exports.list = asyncHandler(async (req, res) => {
  const filtro = {};
  if (req.query.activo === undefined) filtro.activo = true;
  else if (req.query.activo !== 'all') filtro.activo = req.query.activo === 'true';

  const data = await Brand.find(filtro).sort({ nombre: 1 });
  res.json({ success: true, data });
});

// GET /api/v1/brands/:slug
exports.getBySlug = asyncHandler(async (req, res) => {
  const brand = await Brand.findOne({ slug: req.params.slug.toLowerCase() });
  if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Marca no encontrada');
  res.json({ success: true, data: brand });
});

// POST /api/v1/brands   (TODO Etapa E: proteger con auth admin)
exports.create = asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (!data.slug && data.nombre) data.slug = await generateUniqueSlug(Brand, data.nombre);
  const brand = await Brand.create(data);
  res.status(201).json({ success: true, data: brand });
});

// PATCH /api/v1/brands/:id   (TODO Etapa E: proteger con auth admin)
exports.update = asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  if (updates.nombre && !updates.slug) updates.slug = await generateUniqueSlug(Brand, updates.nombre, req.params.id);
  const brand = await Brand.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Marca no encontrada');
  res.json({ success: true, data: brand });
});

// DELETE /api/v1/brands/:id   — soft delete (activo:false) para no romper refs de productos
exports.remove = asyncHandler(async (req, res) => {
  const brand = await Brand.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
  if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Marca no encontrada');
  res.json({ success: true, message: 'Marca desactivada (soft delete)', data: { _id: brand._id, activo: brand.activo } });
});
