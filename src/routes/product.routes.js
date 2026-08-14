const express = require('express');
const router = express.Router();
const c = require('../controllers/product.controller');
const upload = require('../middleware/upload');
const { protect, requireAdmin, protectOptional } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { productCreateSchema, productUpdateSchema } = require('../validators/product.validator');

// --- Lectura (pública) ---
// Rutas específicas ANTES de /:id para que no las capture el parámetro dinámico.
// protectOptional: sigue siendo público (no exige token), pero si el panel
// admin manda su JWT, el controlador puede decidir mostrarle precioDistribuidor
// también a él (si no, el admin nunca vería lo que él mismo configuró al editar).
router.get('/', protectOptional, c.list);
router.get('/slug/:slug', protectOptional, c.getBySlug);
router.get('/sku/:sku', protectOptional, c.getBySku);
router.get('/:id', protectOptional, c.getById);

// --- Escritura (solo admin autenticado) ---
router.post('/', protect, requireAdmin, validate(productCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(productUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

// Imágenes (multipart/form-data, campo "imagenes"; hasta 8 por petición).
router.post('/:id/images', protect, requireAdmin, upload.array('imagenes', 8), c.addImages);
router.delete('/:id/images', protect, requireAdmin, c.removeImage);

module.exports = router;
