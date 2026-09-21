const Product = require('../models/product.model');
const ProductPrice = require('../models/productPrice.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const shape = (p) => ({
  menudeo: p ? p.menudeo : null,
  mayoreo: p ? p.mayoreo : null,
  volumen: p ? p.volumen : null,
  distribuidor: p ? p.distribuidor : null,
  master: p ? p.master : null,
  updatedAt: p ? p.updatedAt : null
});

// GET /api/v1/products/:id/prices  (admin) — nunca expuesto por rutas públicas
// ni por el namespace de distribuidor (X-API-Key). Si el producto todavía no
// tiene precios capturados, responde los 5 en null en vez de 404: el admin
// necesita poder abrir la sección "Precios" de un producto nuevo sin error.
exports.getPrices = asyncHandler(async (req, res) => {
  const exists = await Product.exists({ _id: req.params.id });
  if (!exists) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  const prices = await ProductPrice.findOne({ product: req.params.id });
  res.json({ success: true, data: shape(prices) });
});

// PATCH /api/v1/products/:id/prices  (admin) — crea el documento si no existe
// (upsert) o actualiza solo los campos que vengan en el body. Un campo
// ausente del body no se toca; un campo enviado como null lo deja "sin
// definir" a propósito.
exports.updatePrices = asyncHandler(async (req, res) => {
  const exists = await Product.exists({ _id: req.params.id });
  if (!exists) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  const prices = await ProductPrice.findOneAndUpdate(
    { product: req.params.id },
    { $set: { ...req.body, updatedBy: req.user.id }, $setOnInsert: { product: req.params.id } },
    { new: true, upsert: true, runValidators: true }
  );

  res.json({ success: true, data: shape(prices) });
});
