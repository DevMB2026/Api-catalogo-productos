const Product = require('../models/product.model');
const { dispararWebhookSiAplica } = require('./notification.service');

// Cuando se edita algo que los productos MUESTRAN pero que vive en otra
// colección (el nombre de un color, de una categoría, de una marca, una
// etiqueta, una tabla de medidas…), los productos no cambian por sí solos:
// su updatedAt queda igual y un consumidor que sincroniza con
// /products/changes (o /clientes/productos/changes) nunca se enteraría.
// Aquí se marcan como cambiados (updatedAt = ahora) y se avisa por webhook a
// los distribuidores, igual que si se hubiera editado cada producto.

// Filtro de productos que usan un documento de cada colección.
const FILTROS = {
  optionValue: (id) => ({ $or: [{ 'options.values': id }, { 'variants.optionValues': id }, { 'media.optionValue': id }, { valoresOcultos: id }] }),
  option: (id) => ({ 'options.option': id }),
  category: (id) => ({ category: id }),
  brand: (id) => ({ $or: [{ brand: id }, { brands: id }, { 'skuAliases.brand': id }] }),
  badge: (id) => ({ badges: id }),
  feature: (id) => ({ features: id }),
  application: (id) => ({ applications: id }),
  sizeChart: (id) => ({ $or: [{ sizeChart: id }, { sizeChartHombre: id }, { sizeChartMujer: id }] }),
  attribute: (id) => ({ 'attributes.attribute': id })
};

async function marcarProductosDe(tipo, id) {
  const filtro = FILTROS[tipo] && FILTROS[tipo](id);
  if (!filtro) return 0;
  const ids = (await Product.find(filtro).select('_id').lean()).map((p) => p._id);
  if (!ids.length) return 0;
  const ahora = new Date();
  // timestamps:false para que Mongoose no pise el $set con su propio updatedAt.
  await Product.updateMany({ _id: { $in: ids } }, { $set: { updatedAt: ahora } }, { timestamps: false });
  // Webhooks de uno en uno: son pocos productos por cambio y así no se
  // saturan los endpoints de los distribuidores.
  for (const _id of ids) {
    await dispararWebhookSiAplica({ _id, updatedAt: ahora }, 'actualizado').catch((e) => console.warn('[webhooks] error:', e.message)); // eslint-disable-line no-await-in-loop
  }
  return ids.length;
}

// Versión "dispara y olvida" para usar en los controladores: no retrasa ni
// rompe la respuesta al admin si algo falla.
function avisarProductosDe(tipo, id) {
  marcarProductosDe(tipo, id).catch((e) => console.warn(`[productos afectados] ${tipo} ${id}:`, e.message));
}

module.exports = { marcarProductosDe, avisarProductosDe };
