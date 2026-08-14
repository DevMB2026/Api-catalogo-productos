const express = require('express');
const router = express.Router();
const { authLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { protect, requireAdmin } = require('../middleware/auth');
const { registerSchema } = require('../validators/distributor.validator');
const { createSchema, updateSchema } = require('../validators/adminDistributor.validator');
const c = require('../controllers/distributor.controller');
const adminC = require('../controllers/adminDistributor.controller');
const distributorCatalogRoutes = require('./distributorCatalog.routes');

// Registro público de distribuidores (mismo límite anti-abuso que el login).
router.post('/registro', authLimiter, validate(registerSchema), c.register);

// Etapa 2: catálogo protegido por API Key (X-API-Key). El apiKeyAuth vive
// DENTRO de distributorCatalog.routes.js (router.use), no aquí — así queda
// imposible montar una ruta nueva ahí sin que quede protegida por defecto.
// El catálogo público actual (/api/v1/products) sigue sin tocarse.
router.use('/productos', distributorCatalogRoutes);

// Gestión de distribuidores (panel admin, JWT — nunca X-API-Key). Van DESPUÉS
// de '/registro' y '/productos' para que esos dos literales sigan
// resolviéndose primero y no los capture ':id'.
router.get('/', protect, requireAdmin, adminC.list);
router.post('/', protect, requireAdmin, validate(createSchema), adminC.create);
router.get('/:id', protect, requireAdmin, adminC.getById);
router.patch('/:id', protect, requireAdmin, validate(updateSchema), adminC.update);
router.post('/:id/regenerar-key', protect, requireAdmin, adminC.regenerarKey);
router.post('/:id/revocar-key', protect, requireAdmin, adminC.revocarKey);

module.exports = router;
