const express = require('express');
const router = express.Router();
const c = require('../controllers/catalog.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { catalogCreateSchema, catalogUpdateSchema } = require('../validators/catalog.validator');

// --- Lectura (pública) --- WordPress u otro consumidor puede listar catálogos.
router.get('/', c.list);

// --- Escritura y detalle (solo admin) ---
router.get('/:id', protect, requireAdmin, c.getById);
router.post('/', protect, requireAdmin, validate(catalogCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(catalogUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
