const { z } = require('zod');

const sizeChartCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  slug: z.string().optional(),
  unidad: z.enum(['cm', 'in']).optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.object({
    label: z.string().min(1),
    values: z.array(z.number()).optional()
  })).optional(),
  activo: z.boolean().optional()
});

const sizeChartUpdateSchema = sizeChartCreateSchema.partial();

module.exports = { sizeChartCreateSchema, sizeChartUpdateSchema };
