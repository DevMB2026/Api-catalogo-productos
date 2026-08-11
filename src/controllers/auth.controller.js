const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new AppError(500, 'JWT_NOT_CONFIGURED', 'JWT_SECRET no está configurado en el servidor');
  }
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

// POST /api/v1/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    throw new AppError(400, 'MISSING_CREDENTIALS', 'Email y password son obligatorios');
  }

  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');
  // Mensaje genérico a propósito: no revelar si el email existe.
  if (!user || !user.activo || !(await user.comparePassword(password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
  }

  const token = signToken(user);
  res.json({
    success: true,
    data: { token, user: { id: user._id, email: user.email, role: user.role, nombre: user.nombre } }
  });
});
