const User = require('../models/user.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { createApiKeyForUser } = require('../services/apiKey.service');

// POST /api/v1/distribuidores/registro — público.
// Crea la cuenta del distribuidor y le entrega su API Key de una sola vez.
// El rol SIEMPRE se fija a 'distribuidor' aquí (nunca se lee de req.body):
// así nadie puede registrarse como admin mandando { role: 'admin' }.
exports.register = asyncHandler(async (req, res) => {
  const { nombre, email, password } = req.body;

  const existente = await User.findOne({ email: String(email).toLowerCase() }).select('_id');
  if (existente) throw new AppError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con ese correo');

  const user = await User.create({ nombre, email, password, role: 'distribuidor' });
  const { raw } = await createApiKeyForUser(user._id);

  res.status(201).json({
    success: true,
    message: 'Cuenta creada. Guarda tu API Key ahora: no volverá a mostrarse.',
    data: {
      user: { id: user._id, nombre: user.nombre, email: user.email, role: user.role },
      apiKey: raw
    }
  });
});
