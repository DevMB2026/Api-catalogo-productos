const slugify = require('slugify');

// Genera un slug único para el modelo dado. Si el base ya existe, agrega
// sufijos -2, -3, ... hasta encontrar uno libre. excludeId permite ignorar
// el propio documento al actualizar.
async function generateUniqueSlug(Model, source, excludeId) {
  const base = slugify(String(source || ''), { lower: true, strict: true, trim: true }) || 'item';
  let slug = base;
  let n = 2;
  while (await Model.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

// Genera un SKU único en MAYÚSCULAS a partir de un texto (para migración o
// cuando no se provee SKU). El SKU manual del usuario tiene prioridad.
async function generateUniqueSku(Model, source, excludeId) {
  const base = (slugify(String(source || ''), { lower: false, strict: true, trim: true }) || 'SKU').toUpperCase();
  let sku = base;
  let n = 2;
  while (await Model.exists({ sku, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    sku = `${base}-${n++}`;
  }
  return sku;
}

module.exports = { generateUniqueSlug, generateUniqueSku };
