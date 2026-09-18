const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const requirePriceAccess = require('../middleware/pricePermissions');
const c = require('../controllers/privatePrice.controller');

// Namespace PRIVADO, separado a propósito de /api/v1/products (público) y de
// /api/v1/distribuidores/productos (X-API-Key). Solo personas autenticadas
// con usuario+contraseña (JWT) y con pricePermissions asignados llegan aquí.
router.get('/productos/:id', protect, requirePriceAccess, c.getProductPrices);

module.exports = router;
