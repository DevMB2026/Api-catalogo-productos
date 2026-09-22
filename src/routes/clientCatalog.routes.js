const express = require('express');
const router = express.Router();
const clientKeyAuth = require('../middleware/clientKeyAuth');
const c = require('../controllers/clientCatalog.controller');

// Namespace de CLIENTES (usuarios de precios con API Key `cli_…`): catálogo
// con SKUs y precios permitidos. `router.use` para que cualquier endpoint que
// se agregue aquí después quede protegido por defecto.
router.use(clientKeyAuth);

router.get('/productos', c.list);

module.exports = router;
