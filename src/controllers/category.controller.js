const Category = require('../models/category.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateUniqueSlug } = require('../utils/slug');
const { resolveAttributeSchema } = require('../services/attributeSchema.service');

// GET /api/v1/categories   — ?parent=<id> para subcategorías; ?parent=null para raíces
exports.list = asyncHandler(async (req, res) => {
  const filtro = {};
  if (req.query.activo === undefined) filtro.activo = true;
  else if (req.query.activo !== 'all') filtro.activo = req.query.activo === 'true';

  if (req.query.parent === 'null') filtro.parent = null;
  else if (req.query.parent) filtro.parent = req.query.parent;

  const data = await Category.find(filtro).sort({ orden: 1, nombre: 1 });
  res.json({ success: true, data });
});

// GET /api/v1/categories/:slug
exports.getBySlug = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug.toLowerCase() });
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Categoría no encontrada');
  res.json({ success: true, data: category });
});

// POST /api/v1/categories   (TODO Etapa E: proteger con auth admin)
exports.create = asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (!data.slug && data.nombre) data.slug = await generateUniqueSlug(Category, data.nombre);
  const category = await Category.create(data);
  res.status(201).json({ success: true, data: category });
});

// PATCH /api/v1/categories/:id   (TODO Etapa E: proteger con auth admin)
exports.update = asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  if (updates.nombre && !updates.slug) updates.slug = await generateUniqueSlug(Category, updates.nombre, req.params.id);
  const category = await Category.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Categoría no encontrada');
  res.json({ success: true, data: category });
});

// DELETE /api/v1/categories/:id   — soft delete (activo:false)
exports.remove = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Categoría no encontrada');
  res.json({ success: true, message: 'Categoría desactivada (soft delete)', data: { _id: category._id, activo: category.activo } });
});

// GET /api/v1/categories/:id/attribute-schema  (id o slug)
// Devuelve los atributos aplicables a la categoría, HEREDANDO los de sus padres.
// Es el "esquema del formulario" que consume el panel para pintar el form dinámico.
// Reglas: el nivel más específico (la propia categoría) gana sobre los ancestros;
// se resuelve cada atributo a su definición completa; se omiten los inactivos.
exports.getAttributeSchema = asyncHandler(async (req, res) => {
  const param = req.params.id;
  const byId = /^[0-9a-fA-F]{24}$/.test(param);
  const category = await (byId ? Category.findById(param) : Category.findOne({ slug: param.toLowerCase() }));
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Categoría no encontrada');

  const { attributes } = await resolveAttributeSchema(category);

  res.json({
    success: true,
    data: {
      category: { _id: category._id, nombre: category.nombre, slug: category.slug },
      attributes: attributes.map(({ def, required, orden, heredadoDe }) => ({
        _id: def._id,
        key: def.key,
        label: def.label,
        type: def.type,
        unit: def.unit,
        options: def.options,
        validation: def.validation,
        filterable: def.filterable,
        group: def.group,
        required,
        orden,
        heredadoDe
      }))
    }
  });
});
