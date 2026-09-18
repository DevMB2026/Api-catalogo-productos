const express = require('express');
const router = express.Router();
const c = require('../controllers/badge.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { badgeCreateSchema, badgeUpdateSchema } = require('../validators/badge.validator');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', protect, requireAdmin, validate(badgeCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(badgeUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
