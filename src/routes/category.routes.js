const express = require('express');
const router = express.Router();
const c = require('../controllers/category.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { categoryCreateSchema, categoryUpdateSchema } = require('../validators/category.validator');

router.get('/', c.list);
router.get('/:slug', c.getBySlug);

// Escritura (solo admin autenticado).
router.post('/', protect, requireAdmin, validate(categoryCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(categoryUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
