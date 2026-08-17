const { z } = require('zod');

const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido (ObjectId de 24 hex)');

// Sin campo de marcas a propósito: por defecto cualquier distribuidor con API
// Key válida puede consultar cualquiera de las marcas del catálogo completo.
// `catalogo` es OPCIONAL y explícito: solo si el admin lo asigna, ese
// distribuidor queda restringido a ese catálogo (ver Catalog). Ausente/null
// = acceso completo, igual que siempre.
const createSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  email: z.email('Email inválido'),
  catalogo: mongoId.optional().nullable()
});

const updateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio').optional(),
  activo: z.boolean().optional(),
  catalogo: mongoId.optional().nullable()
});

module.exports = { createSchema, updateSchema };
