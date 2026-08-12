const express = require('express');
const router = express.Router();
const c = require('../controllers/option.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { optionCreateSchema, optionUpdateSchema } = require('../validators/option.validator');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', protect, requireAdmin, validate(optionCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(optionUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
