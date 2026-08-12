const { z } = require('zod');

const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido (debe ser un ObjectId de 24 hex)');

const categoryCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  parent: mongoId.nullable().optional(),
  orden: z.number().optional(),
  activo: z.boolean().optional(),
  // Atributos permitidos para esta categoría (PIM dinámico).
  attributeDefs: z.array(z.object({
    attribute: mongoId,
    required: z.boolean().optional(),
    orden: z.number().optional()
  })).optional()
});

const categoryUpdateSchema = categoryCreateSchema.partial();

module.exports = { categoryCreateSchema, categoryUpdateSchema };
