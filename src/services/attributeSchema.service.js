const mongoose = require('mongoose');
const Category = require('../models/category.model');
const AttributeDefinition = require('../models/attributeDefinition.model');
const AppError = require('../utils/AppError');

// Resuelve los atributos aplicables a una categoría HEREDANDO los de sus padres.
// El nivel más específico gana. Devuelve { category, attributes: [{ def, required,
// orden, heredadoDe }] } ya ordenado (group → orden → label). Los atributos con
// definición inactiva o eliminada se omiten.
//
// Fuente única de verdad usada por:
//   - GET /categories/:id/attribute-schema  (panel: pinta el formulario)
//   - la validación dinámica de Product      (API: valida los valores)
async function resolveAttributeSchema(categoryOrId) {
  // Acepta un id (ObjectId o string hex) o un documento de categoría ya cargado.
  const category = mongoose.isValidObjectId(categoryOrId)
    ? await Category.findById(categoryOrId)
    : categoryOrId;
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Categoría no encontrada');

  const chain = [];
  const visited = new Set();
  let current = category;
  let guard = 0;
  while (current && guard < 20) {
    if (visited.has(String(current._id))) break;
    visited.add(String(current._id));
    chain.push(current);
    if (!current.parent) break;
    current = await Category.findById(current.parent); // eslint-disable-line no-await-in-loop
    guard += 1;
  }

  const linkByAttr = new Map(); // el más cercano gana
  for (const cat of chain) {
    for (const def of cat.attributeDefs || []) {
      const key = String(def.attribute);
      if (!linkByAttr.has(key)) linkByAttr.set(key, { link: def, source: cat });
    }
  }

  const ids = [...linkByAttr.keys()];
  const defs = ids.length ? await AttributeDefinition.find({ _id: { $in: ids }, activo: true }) : [];
  const defById = new Map(defs.map((d) => [String(d._id), d]));

  const attributes = [];
  for (const [attrId, { link, source }] of linkByAttr) {
    const def = defById.get(attrId);
    if (!def) continue;
    attributes.push({
      def,
      required: link.required === true,
      orden: link.orden != null ? link.orden : (def.orden || 0),
      heredadoDe: String(source._id) === String(category._id) ? null : source.slug
    });
  }

  attributes.sort((a, b) =>
    (a.def.group || '').localeCompare(b.def.group || '')
    || (a.orden - b.orden)
    || a.def.label.localeCompare(b.def.label)
  );

  return { category, attributes };
}

module.exports = { resolveAttributeSchema };
