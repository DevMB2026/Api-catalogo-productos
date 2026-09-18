const express = require('express');
const router = express.Router();
const c = require('../controllers/product.controller');
const priceC = require('../controllers/price.controller');
const upload = require('../middleware/upload');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { productCreateSchema, productUpdateSchema, imageMetaUpdateSchema, imageReorderSchema } = require('../validators/product.validator');
const { priceUpdateSchema } = require('../validators/price.validator');

// --- Lectura (pública) ---
// Rutas específicas ANTES de /:id para que no las capture el parámetro dinámico.
router.get('/', c.list);
router.get('/changes', c.changes);
router.get('/slug/:slug', c.getBySlug);
router.get('/sku/:sku', c.getBySku);
router.get('/:id', c.getById);

// --- Escritura (solo admin autenticado) ---
router.post('/', protect, requireAdmin, validate(productCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(productUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

// Imágenes (multipart/form-data, campo "imagenes"; hasta 8 por petición).
router.post('/:id/images', protect, requireAdmin, upload.array('imagenes', 8), c.addImages);
router.patch('/:id/images', protect, requireAdmin, validate(imageMetaUpdateSchema), c.updateImageMeta);
router.patch('/:id/images/order', protect, requireAdmin, validate(imageReorderSchema), c.reorderImages);
router.delete('/:id/images', protect, requireAdmin, c.removeImage);

// Precios (privados) — solo admin. NUNCA se exponen por rutas públicas ni por
// el namespace de distribuidor (distributorCatalog.routes.js), que reutiliza
// product.controller.js pero no toca price.controller.js.
router.get('/:id/prices', protect, requireAdmin, priceC.getPrices);
router.patch('/:id/prices', protect, requireAdmin, validate(priceUpdateSchema), priceC.updatePrices);

module.exports = router;
