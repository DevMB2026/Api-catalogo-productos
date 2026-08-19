const express = require('express');
const router = express.Router();
const c = require('../controllers/notification.controller');
const { protect, requireAdmin } = require('../middleware/auth');

// Historial de avisos (desactivado/agotado) — solo admin.
router.get('/', protect, requireAdmin, c.list);

module.exports = router;
