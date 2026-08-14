const { z } = require('zod');

// Sin campo de marcas a propósito: cualquier distribuidor con API Key válida
// puede consultar cualquiera de las marcas del catálogo (lo elige él mismo
// desde /distribuidor, no el admin). El admin solo gestiona la cuenta.
const createSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  email: z.email('Email inválido')
});

const updateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio').optional(),
  activo: z.boolean().optional()
});

module.exports = { createSchema, updateSchema };
