const AppError = require('./AppError');
const asyncHandler = require('./asyncHandler');
const { generateUniqueSlug } = require('./slug');

// Fábrica de controladores CRUD estándar para las colecciones simples del PIM
// (atributos, features, applications, options, option-values, size-charts).
// Centraliza: filtro por `activo`, slug único opcional, populate, y soft-delete.
//
// opts:
//   code      prefijo del código de error (ej. 'FEATURE' → 'FEATURE_NOT_FOUND')
//   slugFrom  campo desde el que autogenerar `slug` único (ej. 'nombre')
//   populate  arg de populate para las lecturas
//   sort      orden de la lista (default { createdAt: -1 })
//   filters   campos de query permitidos como filtro exacto (ej. ['option'])
module.exports = function crudController(Model, opts = {}) {
  const { code = 'RESOURCE', slugFrom, populate, sort = { createdAt: -1 }, filters = [] } = opts;
  const notFound = () => new AppError(404, `${code}_NOT_FOUND`, 'Recurso no encontrado');
  const withPop = (q) => (populate ? q.populate(populate) : q);

  const list = asyncHandler(async (req, res) => {
    const filtro = {};
    if (req.query.activo === undefined) filtro.activo = true;
    else if (req.query.activo !== 'all') filtro.activo = req.query.activo === 'true';
    for (const f of filters) if (req.query[f] !== undefined) filtro[f] = req.query[f];

    const data = await withPop(Model.find(filtro).sort(sort));
    res.json({ success: true, data });
  });

  const getById = asyncHandler(async (req, res) => {
    const doc = await withPop(Model.findById(req.params.id));
    if (!doc) throw notFound();
    res.json({ success: true, data: doc });
  });

  const create = asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (slugFrom && !body.slug && body[slugFrom]) {
      body.slug = await generateUniqueSlug(Model, body[slugFrom]);
    }
    const created = await Model.create(body);
    const doc = await withPop(Model.findById(created._id));
    res.status(201).json({ success: true, data: doc });
  });

  const update = asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (slugFrom && body[slugFrom] && !body.slug) {
      body.slug = await generateUniqueSlug(Model, body[slugFrom], req.params.id);
    }
    const updated = await Model.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    if (!updated) throw notFound();
    const doc = await withPop(Model.findById(updated._id));
    res.json({ success: true, data: doc });
  });

  // Soft delete (activo:false) para no romper referencias desde productos.
  const remove = asyncHandler(async (req, res) => {
    const doc = await Model.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
    if (!doc) throw notFound();
    res.json({ success: true, message: 'Recurso desactivado', data: { _id: doc._id, activo: doc.activo } });
  });

  return { list, getById, create, update, remove };
};
