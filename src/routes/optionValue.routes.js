const express = require('express');
const router = express.Router();
const c = require('../controllers/optionValue.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { optionValueCreateSchema, optionValueUpdateSchema } = require('../validators/optionValue.validator');

// GET /?option=<id> filtra por opción.
router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', protect, requireAdmin, validate(optionValueCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(optionValueUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
