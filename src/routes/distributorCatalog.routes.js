const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const validate = require('../middleware/validate');
const c = require('../controllers/product.controller');
const webhookC = require('../controllers/webhook.controller');
const { webhookRegisterSchema } = require('../validators/webhook.validator');

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
router.get('/changes', c.changes);
router.get('/slug/:slug', c.getBySlug);
router.get('/sku/:sku', c.getBySku);
router.get('/:id', c.getById);

router.post('/webhook', validate(webhookRegisterSchema), webhookC.register);
router.delete('/webhook', webhookC.unregister);

module.exports = router;
