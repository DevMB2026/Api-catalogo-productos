const { z } = require('zod');

const registerSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  email: z.email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres')
});

module.exports = { registerSchema };
