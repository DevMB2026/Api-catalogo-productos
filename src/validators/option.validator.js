const { z } = require('zod');

const optionCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  tipo: z.enum(['swatch', 'size', 'text']).optional(),
  orden: z.number().optional(),
  activo: z.boolean().optional()
});

const optionUpdateSchema = optionCreateSchema.partial();

module.exports = { optionCreateSchema, optionUpdateSchema };
