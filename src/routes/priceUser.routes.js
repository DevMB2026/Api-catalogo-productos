const express = require('express');
const router = express.Router();
const { protect, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createSchema, updateSchema } = require('../validators/priceUser.validator');
const c = require('../controllers/priceUser.controller');

// Gestión de "usuarios con acceso a precios" (panel admin). `router.use`
// (no cada ruta por separado) para que cualquier endpoint que se agregue
// después a este archivo quede protegido por defecto — mismo patrón que
// distributorCatalog.routes.js con apiKeyAuth.
router.use(protect, requireAdmin);

router.get('/', c.list);
router.post('/', validate(createSchema), c.create);
router.get('/:id', c.getById);
router.patch('/:id', validate(updateSchema), c.update);
router.post('/:id/reset-password', c.resetPassword);

module.exports = router;
