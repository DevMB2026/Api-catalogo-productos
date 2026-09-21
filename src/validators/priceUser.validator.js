const { z } = require('zod');

const TIPOS = ['menudeo', 'mayoreo', 'volumen', 'distribuidor', 'master'];

// role/password NO están en ningún schema a propósito: el role siempre se
// fija en el controller (nunca desde el body, mismo principio que
// adminDistributor.validator.js) y la contraseña siempre la genera el
// servidor (ver priceUser.controller.js), nunca se acepta en texto plano
// por la API.
const createSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio'),
  email: z.string().trim().email('Email inválido'),
  pricePermissions: z.array(z.enum(TIPOS)).optional()
});

const updateSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  activo: z.boolean().optional(),
  pricePermissions: z.array(z.enum(TIPOS)).optional()
});

module.exports = { createSchema, updateSchema };
