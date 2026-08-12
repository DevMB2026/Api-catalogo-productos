const express = require('express');
const router = express.Router();
const c = require('../controllers/sizeChart.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sizeChartCreateSchema, sizeChartUpdateSchema } = require('../validators/sizeChart.validator');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', protect, requireAdmin, validate(sizeChartCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(sizeChartUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
