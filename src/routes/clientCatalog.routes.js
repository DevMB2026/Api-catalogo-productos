const express = require('express');
const router = express.Router();
const clientKeyAuth = require('../middleware/clientKeyAuth');
const c = require('../controllers/clientCatalog.controller');

// Namespace de CLIENTES (usuarios de precios con API Key `cli_…`): catálogo
// con SKUs y precios permitidos. `router.use` para que cualquier endpoint que
// se agregue aquí después quede protegido por defecto.
router.use(clientKeyAuth);

router.get('/productos', c.list);
// Rutas fijas ANTES de /productos/:id para que "changes" o "sku" no se lean como id.
router.get('/productos/changes', c.changes);
router.get('/productos/sku/:sku', c.getBySku);
router.get('/productos/:id', c.getById);

module.exports = router;
