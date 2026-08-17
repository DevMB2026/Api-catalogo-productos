const crypto = require('crypto');
const User = require('../models/user.model');
const ApiKey = require('../models/apiKey.model');
const Catalog = require('../models/catalog.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { createApiKeyForUser } = require('../services/apiKey.service');

// Si viene `catalogo` en el body, confirma que referencia un Catalog real
// antes de guardarlo — mismo rigor que el resto de la API con referencias.
async function assertCatalogExists(catalogId) {
  if (!catalogId) return; // undefined (no cambia) o null (desasignar) — nada que validar
  const existe = await Catalog.exists({ _id: catalogId });
  if (!existe) throw new AppError(400, 'INVALID_CATALOG', 'El catálogo indicado no existe');
}

// Endpoints de gestión de distribuidores para el PANEL ADMIN (protect+requireAdmin,
// nunca X-API-Key). El admin solo crea la cuenta y controla la API Key — la
// selección de marcas a consultar la hace el propio distribuidor en /distribuidor.

const keyMeta = (k) => (k ? { prefijo: k.prefijo, activo: k.activo, revocada: k.revocada, ultimoUso: k.ultimoUso } : null);

// GET /api/v1/distribuidores — lista de distribuidores + estado de su API Key.
exports.list = asyncHandler(async (req, res) => {
  const filtro = { role: 'distribuidor' };
  if (req.query.activo !== undefined && req.query.activo !== 'all') filtro.activo = req.query.activo === 'true';

  const distribuidores = await User.find(filtro).select('nombre email activo createdAt catalogo').populate('catalogo', 'nombre slug').sort({ createdAt: -1 });
  const ids = distribuidores.map((d) => d._id);
  const apiKeys = await ApiKey.find({ user: { $in: ids } }).sort({ createdAt: -1 });

  // La más reciente por usuario (ya viene ordenado desc por createdAt).
  const ultimaKeyPorUsuario = new Map();
  for (const k of apiKeys) {
    const uid = k.user.toString();
    if (!ultimaKeyPorUsuario.has(uid)) ultimaKeyPorUsuario.set(uid, k);
  }

  const data = distribuidores.map((d) => ({
    _id: d._id,
    nombre: d.nombre,
    email: d.email,
    activo: d.activo,
    createdAt: d.createdAt,
    catalogo: d.catalogo || null,
    apiKey: keyMeta(ultimaKeyPorUsuario.get(d._id.toString()))
  }));

  res.json({ success: true, data });
});

// GET /api/v1/distribuidores/:id
exports.getById = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'distribuidor' })
    .select('nombre email activo createdAt catalogo')
    .populate('catalogo', 'nombre slug');
  if (!user) throw new AppError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distribuidor no encontrado');

  const apiKey = await ApiKey.findOne({ user: user._id }).sort({ createdAt: -1 });
  res.json({
    success: true,
    data: {
      _id: user._id, nombre: user.nombre, email: user.email, activo: user.activo, createdAt: user.createdAt,
      catalogo: user.catalogo || null, apiKey: keyMeta(apiKey)
    }
  });
});

// POST /api/v1/distribuidores — crea la cuenta y su API Key (se devuelve UNA SOLA VEZ).
// El rol siempre se fija aquí (nunca desde req.body) — mismo principio que el registro público.
exports.create = asyncHandler(async (req, res) => {
  const { nombre, email, catalogo } = req.body;

  const existente = await User.findOne({ email: String(email).toLowerCase() }).select('_id');
  if (existente) throw new AppError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con ese correo');

  await assertCatalogExists(catalogo);

  // Los distribuidores nunca inician sesión con contraseña (solo usan su API
  // Key) — se genera una aleatoria únicamente para satisfacer el modelo;
  // nunca se expone, nunca se usa para autenticar.
  const password = crypto.randomBytes(32).toString('hex');
  const user = await User.create({ nombre, email, password, role: 'distribuidor', catalogo: catalogo || null });
  const { raw } = await createApiKeyForUser(user._id);

  res.status(201).json({
    success: true,
    message: 'Distribuidor creado. Copia la API Key ahora: no volverá a mostrarse.',
    data: {
      user: { id: user._id, nombre: user.nombre, email: user.email, activo: user.activo, catalogo: user.catalogo },
      apiKey: raw
    }
  });
});

// PATCH /api/v1/distribuidores/:id — nombre, activo y/o catalogo (null = desasignar).
exports.update = asyncHandler(async (req, res) => {
  const updates = {};
  if (req.body.nombre !== undefined) updates.nombre = req.body.nombre;
  if (req.body.activo !== undefined) updates.activo = req.body.activo;
  if (req.body.catalogo !== undefined) {
    await assertCatalogExists(req.body.catalogo);
    updates.catalogo = req.body.catalogo; // puede ser null explícito -> desasignar
  }

  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'distribuidor' },
    updates,
    { new: true, runValidators: true }
  ).select('nombre email activo createdAt catalogo').populate('catalogo', 'nombre slug');
  if (!user) throw new AppError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distribuidor no encontrado');

  res.json({ success: true, data: user });
});

// POST /api/v1/distribuidores/:id/regenerar-key — desactiva la key anterior y
// entrega una nueva (una sola vez). Reutiliza el mismo servicio de Etapa 1.
exports.regenerarKey = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'distribuidor' }).select('_id');
  if (!user) throw new AppError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distribuidor no encontrado');

  const { raw } = await createApiKeyForUser(user._id);
  res.json({ success: true, message: 'Nueva API Key generada. Cópiala ahora: no volverá a mostrarse.', data: { apiKey: raw } });
});

// POST /api/v1/distribuidores/:id/revocar-key — apaga el acceso sin generar una nueva.
exports.revocarKey = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'distribuidor' }).select('_id');
  if (!user) throw new AppError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distribuidor no encontrado');

  const result = await ApiKey.updateMany({ user: user._id, activo: true }, { activo: false, revocada: true });
  res.json({ success: true, message: 'API Key revocada', data: { keysRevocadas: result.modifiedCount } });
});
