const { z } = require('zod');

const applicationCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  descripcion: z.string().optional(),
  icono: z.string().optional(),
  activo: z.boolean().optional()
});

const applicationUpdateSchema = applicationCreateSchema.partial();

module.exports = { applicationCreateSchema, applicationUpdateSchema };
