const express = require('express');
const router = express.Router();
const c = require('../controllers/product.controller');
const upload = require('../middleware/upload');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { productCreateSchema, productUpdateSchema, imageMetaUpdateSchema } = require('../validators/product.validator');

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
router.delete('/:id/images', protect, requireAdmin, c.removeImage);

module.exports = router;
