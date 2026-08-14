const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Usuario administrador para autenticar las operaciones de escritura.
// La contraseña se guarda SIEMPRE hasheada y no se devuelve por defecto (select:false).
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false, minlength: 8 },
  nombre: { type: String, trim: true },
  role: { type: String, enum: ['admin', 'distribuidor'], default: 'admin' },
  activo: { type: Boolean, default: true }
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
