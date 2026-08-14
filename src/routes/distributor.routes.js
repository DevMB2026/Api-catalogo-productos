const express = require('express');
const router = express.Router();
const { authLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { registerSchema } = require('../validators/distributor.validator');
const c = require('../controllers/distributor.controller');
const distributorCatalogRoutes = require('./distributorCatalog.routes');

// Registro público de distribuidores (mismo límite anti-abuso que el login).
router.post('/registro', authLimiter, validate(registerSchema), c.register);

// Etapa 2: catálogo protegido por API Key (X-API-Key). El apiKeyAuth vive
// DENTRO de distributorCatalog.routes.js (router.use), no aquí — así queda
// imposible montar una ruta nueva ahí sin que quede protegida por defecto.
// El catálogo público actual (/api/v1/products) sigue sin tocarse.
router.use('/productos', distributorCatalogRoutes);

module.exports = router;
