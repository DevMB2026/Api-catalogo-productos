const express = require('express');
const router = express.Router();
const c = require('../controllers/bot.controller');

// Ficha compacta para el chatbot. Solo lectura y pública (sin precios, sin
// stock, sin SKUs). Ver controllers/bot.controller.js.
router.get('/ficha', c.ficha);

module.exports = router;
