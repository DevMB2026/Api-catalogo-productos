const crypto = require('crypto');
const User = require('../models/user.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Endpoints de gestión de "usuarios con acceso a precios" para el PANEL ADMIN
// (protect+requireAdmin, ver priceUser.routes.js). Gestiona EXCLUSIVAMENTE
// cuentas role:'usuario' — nunca lee ni modifica admin/distribuidor, así que
// no puede afectar por accidente esos flujos existentes. El role se fija
// SIEMPRE aquí (nunca desde req.body — ni el validador lo acepta), mismo
// principio que adminDistributor.controller.js con los distribuidores.

// Contraseña aleatoria de alta entropía (CSPRNG), igual que las API Key de
// distribuidor: se genera en el servidor, nunca se acepta por la API en
// texto plano, y se devuelve UNA SOLA VEZ en la respuesta de create/reset.
function generatePassword() {
  return crypto.randomBytes(16).toString('hex');
}

// Nunca incluye password (select:false en el modelo ya lo excluye por
// defecto; esto es una segunda barrera explícita).
const shape = (u) => ({
  _id: u._id,
  nombre: u.nombre,
  email: u.email,
  activo: u.activo,
  pricePermissions: u.pricePermissions,
  createdAt: u.createdAt
});

// GET /api/v1/usuarios-precios
exports.list = asyncHandler(async (req, res) => {
  const filtro = { role: 'usuario' };
  if (req.query.activo !== undefined && req.query.activo !== 'all') filtro.activo = req.query.activo === 'true';

  const usuarios = await User.find(filtro).sort({ createdAt: -1 });
  res.json({ success: true, data: usuarios.map(shape) });
});

// GET /api/v1/usuarios-precios/:id
exports.getById = asyncHandler(async (req, res) => {
  const usuario = await User.findOne({ _id: req.params.id, role: 'usuario' });
  if (!usuario) throw new AppError(404, 'PRICE_USER_NOT_FOUND', 'Usuario no encontrado');
  res.json({ success: true, data: shape(usuario) });
});

// POST /api/v1/usuarios-precios — crea con role:'usuario' fijo y los
// permisos que se indiquen (o ninguno: cero permisos es un estado válido,
// el usuario simplemente no puede consultar nada hasta que se le asignen).
exports.create = asyncHandler(async (req, res) => {
  const { nombre, email, pricePermissions } = req.body;

  const existente = await User.findOne({ email: String(email).toLowerCase() }).select('_id');
  if (existente) throw new AppError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con ese correo');

  const password = generatePassword();
  const usuario = await User.create({
    nombre,
    email,
    password,
    role: 'usuario',
    activo: true,
    pricePermissions: pricePermissions || []
  });

  res.status(201).json({
    success: true,
    message: 'Usuario creado. Copia la contraseña ahora: no volverá a mostrarse.',
    data: { user: shape(usuario), password }
  });
});

// PATCH /api/v1/usuarios-precios/:id — nombre, activo y/o pricePermissions.
// Nunca toca email, password ni role. Un permiso ausente del body no se
// toca; para quitarlo hay que mandar el array completo sin él (mismo
// principio "manda la lista completa" que ya usa reorderImages).
exports.update = asyncHandler(async (req, res) => {
  const updates = {};
  if (req.body.nombre !== undefined) updates.nombre = req.body.nombre;
  if (req.body.activo !== undefined) updates.activo = req.body.activo;
  if (req.body.pricePermissions !== undefined) updates.pricePermissions = req.body.pricePermissions;

  const usuario = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'usuario' },
    updates,
    { new: true, runValidators: true }
  );
  if (!usuario) throw new AppError(404, 'PRICE_USER_NOT_FOUND', 'Usuario no encontrado');

  res.json({ success: true, data: shape(usuario) });
});

// POST /api/v1/usuarios-precios/:id/reset-password — genera y entrega una
// contraseña nueva (una sola vez), mismo patrón que regenerar-key de
// distribuidores. Se asigna vía save() (no findOneAndUpdate) para que corra
// el pre('save') del modelo que la hashea — findOneAndUpdate NO dispara ese hook.
exports.resetPassword = asyncHandler(async (req, res) => {
  const usuario = await User.findOne({ _id: req.params.id, role: 'usuario' });
  if (!usuario) throw new AppError(404, 'PRICE_USER_NOT_FOUND', 'Usuario no encontrado');

  const password = generatePassword();
  usuario.password = password;
  await usuario.save();

  res.json({ success: true, message: 'Contraseña restablecida. Cópiala ahora: no volverá a mostrarse.', data: { password } });
});
