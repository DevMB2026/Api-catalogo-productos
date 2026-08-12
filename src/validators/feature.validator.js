const { z } = require('zod');

const featureCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  icono: z.string().optional(),
  descripcion: z.string().optional(),
  orden: z.number().optional(),
  activo: z.boolean().optional()
});

const featureUpdateSchema = featureCreateSchema.partial();

module.exports = { featureCreateSchema, featureUpdateSchema };
