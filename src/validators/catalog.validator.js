const { z } = require('zod');

const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido (ObjectId de 24 hex)');

const catalogCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  marcaPrincipal: mongoId.optional().nullable(),
  productosAdicionales: z.array(mongoId).optional(),
  activo: z.boolean().optional()
});

const catalogUpdateSchema = catalogCreateSchema.partial();

module.exports = { catalogCreateSchema, catalogUpdateSchema };
