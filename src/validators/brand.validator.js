const { z } = require('zod');

const brandCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  dominio: z.string().optional(),
  logo: z.object({
    url: z.string().optional(),
    public_id: z.string().optional()
  }).optional(),
  activo: z.boolean().optional(),
  orden: z.number().optional()
});

const brandUpdateSchema = brandCreateSchema.partial();

module.exports = { brandCreateSchema, brandUpdateSchema };
