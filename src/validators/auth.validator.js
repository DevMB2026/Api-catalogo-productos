const { z } = require('zod');

const loginSchema = z.object({
  email: z.email('Email inválido'),
  password: z.string().min(1, 'La contraseña es obligatoria')
});

module.exports = { loginSchema };
