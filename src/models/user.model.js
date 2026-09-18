const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Usuario administrador para autenticar las operaciones de escritura.
// La contraseña se guarda SIEMPRE hasheada y no se devuelve por defecto (select:false).
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false, minlength: 8 },
  nombre: { type: String, trim: true },
  // 'usuario' = persona sin panel administrativo y sin API Key, que solo
  // puede iniciar sesión para consultar precios autorizados (ver
  // pricePermissions). Esta etiqueta no otorga ningún acceso por sí misma —
  // es solo "no es admin, no es distribuidor"; el acceso real a precios lo
  // decide pricePermissions, no el rol.
  role: { type: String, enum: ['admin', 'distribuidor', 'usuario'], default: 'admin' },
  activo: { type: Boolean, default: true },
  // Solo aplica a distribuidores. Sin asignar (null) = acceso al catálogo
  // completo, igual que hoy. Un valor asignado aquí es la ÚNICA fuente de
  // verdad de qué catálogo ve ese distribuidor — nunca algo que el propio
  // distribuidor pueda mandar/cambiar por parámetro.
  catalogo: { type: mongoose.Schema.Types.ObjectId, ref: 'Catalog', default: null },

  // Qué tipos de precio puede consultar esta persona — independiente del
  // rol: un admin, un distribuidor o un 'usuario' pueden tener cualquier
  // combinación (o ninguna). Un permiso NUNCA implica otro; se asignan
  // explícitos uno por uno.
  pricePermissions: {
    type: [{ type: String, enum: ['menudeo', 'mayoreo', 'distribuidor', 'master'] }],
    default: []
  }
}, { timestamps: true });

// Hashea la contraseña antes de guardar (solo si cambió). La validación de
// longitud corre antes, sobre el texto plano.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
