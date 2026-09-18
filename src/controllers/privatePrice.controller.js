const Product = require('../models/product.model');
const ProductPrice = require('../models/productPrice.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const TIPOS = ['menudeo', 'mayoreo', 'distribuidor', 'master'];

// GET /api/v1/precios/productos/:id  (protect + requirePriceAccess)
//
// Devuelve ÚNICAMENTE los tipos de precio que req.pricePermissions permite
// (resuelto en el middleware, fresco desde Mongo). Un tipo no permitido
// JAMÁS aparece en la respuesta — ni siquiera si se pide explícitamente por
// ?tipos=, y ni siquiera como null — así no hay forma de distinguir desde
// afuera "no tienes permiso para este tipo" de "este tipo no existe". Un
// tipo SÍ permitido pero todavía sin capturar en ProductPrice sí aparece,
// como null (misma semántica que el panel admin: "aún no definido").
exports.getProductPrices = asyncHandler(async (req, res) => {
  const exists = await Product.exists({ _id: req.params.id });
  if (!exists) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  const pedidos = req.query.tipos
    ? String(req.query.tipos).split(',').map((t) => t.trim()).filter((t) => TIPOS.includes(t))
    : TIPOS;
  const permitidos = pedidos.filter((t) => req.pricePermissions.includes(t));

  const priceDoc = await ProductPrice.findOne({ product: req.params.id });

  const prices = {};
  for (const tipo of permitidos) {
    prices[tipo] = priceDoc ? priceDoc[tipo] : null;
  }

  res.json({ success: true, data: { product: req.params.id, prices } });
});
