const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const c = require('../controllers/product.controller');

// Namespace de catálogo para DISTRIBUIDORES. Reutiliza EXACTAMENTE los mismos
// controladores que el catálogo público (src/controllers/product.controller.js)
// — ninguna lógica de negocio se duplica aquí, solo se le antepone la
// exigencia de una API Key válida.
//
// `router.use` (no cada ruta por separado) para que CUALQUIER endpoint que se
// agregue después a este archivo quede protegido por defecto, sin tener que
// acordarse de añadir el middleware cada vez.
router.use(apiKeyAuth);

router.get('/', c.list);
router.get('/slug/:slug', c.getBySlug);
router.get('/sku/:sku', c.getBySku);
router.get('/:id', c.getById);

module.exports = router;
