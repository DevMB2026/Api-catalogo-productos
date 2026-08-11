const express = require('express');
const router = express.Router();
const { authLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { loginSchema } = require('../validators/auth.validator');
const c = require('../controllers/auth.controller');

router.post('/login', authLimiter, validate(loginSchema), c.login);

module.exports = router;
