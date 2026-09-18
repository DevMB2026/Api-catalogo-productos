const { z } = require('zod');

const badgeCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  orden: z.number().optional(),
  activo: z.boolean().optional()
});

const badgeUpdateSchema = badgeCreateSchema.partial();

module.exports = { badgeCreateSchema, badgeUpdateSchema };
