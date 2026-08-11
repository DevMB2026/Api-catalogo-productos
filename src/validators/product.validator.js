const { z } = require('zod');

const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido (debe ser un ObjectId de 24 hex)');

const imageInput = z.object({
  url: z.string().min(1),
  public_id: z.string().min(1),
  alt: z.string().optional(),
  orden: z.number().optional(),
  principal: z.boolean().optional()
});

const variantInput = z.object({
  sku: z.string().optional(),
  color: z.string().min(1, 'El color de la variante es obligatorio'),
  composicion: z.string().optional(),
  tallas: z.array(z.string()).optional(),
  imagenes: z.array(imageInput).optional(),
  principal: z.boolean().optional()
});

const productCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  sku: z.string().min(1, 'El SKU es obligatorio'),
  slug: z.string().optional(),
  descripcion: z.string().optional(),
  brand: mongoId,
  category: mongoId,
  subcategory: mongoId.optional(),
  linea: z.string().optional(),
  sexo: z.enum(['hombre', 'mujer', 'unisex']),
  tela: z.object({
    material: z.string().optional(),
    composicion: z.string().optional(),
    tipo: z.string().optional(),
    peso: z.string().optional(),
    cuidados: z.array(z.string()).optional()
  }).optional(),
  aplicaciones: z.array(z.enum(['bordado', 'dtf', 'vinil', 'sublimado'])).optional(),
  atributos: z.record(z.string(), z.any()).optional(),
  variants: z.array(variantInput).optional(),
  sizeGuide: z.array(z.object({
    talla: z.string().min(1),
    medidas: z.record(z.string(), z.number()).optional()
  })).optional(),
  faq: z.array(z.object({
    pregunta: z.string().min(1),
    respuesta: z.string().min(1)
  })).optional(),
  infoAdicional: z.string().optional(),
  destacado: z.boolean().optional(),
  activo: z.boolean().optional()
});

// En update todo es opcional (PATCH parcial).
const productUpdateSchema = productCreateSchema.partial();

module.exports = { productCreateSchema, productUpdateSchema };
