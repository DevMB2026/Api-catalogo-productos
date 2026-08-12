const express = require('express');
const router = express.Router();
const c = require('../controllers/application.controller');
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { applicationCreateSchema, applicationUpdateSchema } = require('../validators/application.validator');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', protect, requireAdmin, validate(applicationCreateSchema), c.create);
router.patch('/:id', protect, requireAdmin, validate(applicationUpdateSchema), c.update);
router.delete('/:id', protect, requireAdmin, c.remove);

module.exports = router;
