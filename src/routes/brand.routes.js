const express = require('express');
const router = express.Router();
const c = require('../controllers/brand.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { brandCreateSchema, brandUpdateSchema } = require('../validators/brand.validator');

router.get('/', c.list);
router.get('/:slug', c.getBySlug);

// Escritura (solo admin autenticado).
router.post('/', protect, requireAdmin, validate(brandCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(brandUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
