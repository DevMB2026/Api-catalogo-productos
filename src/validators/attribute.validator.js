const { z } = require('zod');

const attributeCreateSchema = z.object({
  key: z.string().optional(), // se autogenera del label si no viene
  label: z.string().min(1, 'El label es obligatorio'),
  type: z.enum(['text', 'number', 'boolean', 'select', 'multiselect']),
  unit: z.string().optional(),
  options: z.array(z.object({
    value: z.string().min(1),
    label: z.string().optional()
  })).optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    regex: z.string().optional(),
    maxLength: z.number().optional()
  }).optional(),
  filterable: z.boolean().optional(),
  group: z.string().optional(),
  orden: z.number().optional(),
  activo: z.boolean().optional()
});

const attributeUpdateSchema = attributeCreateSchema.partial();

module.exports = { attributeCreateSchema, attributeUpdateSchema };
