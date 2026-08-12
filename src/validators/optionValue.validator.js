const { z } = require('zod');

const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido (ObjectId de 24 hex)');

const optionValueCreateSchema = z.object({
  option: mongoId,
  valor: z.string().min(1, 'El valor es obligatorio'),
  slug: z.string().optional(),
  meta: z.record(z.string(), z.any()).optional(), // ej. { hex: "#000000" }
  orden: z.number().optional(),
  activo: z.boolean().optional()
});

// En update `option` no se cambia normalmente, pero se permite opcional.
const optionValueUpdateSchema = optionValueCreateSchema.partial();

module.exports = { optionValueCreateSchema, optionValueUpdateSchema };
