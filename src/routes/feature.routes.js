const express = require('express');
const router = express.Router();
const c = require('../controllers/feature.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { featureCreateSchema, featureUpdateSchema } = require('../validators/feature.validator');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', protect, requireAdmin, validate(featureCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(featureUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
