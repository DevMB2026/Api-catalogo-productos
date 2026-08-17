const { z } = require('zod');

const mongoId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido (ObjectId de 24 hex)');

const mediaInput = z.object({
  url: z.string().min(1),
  public_id: z.string().min(1),
  alt: z.string().optional(),
  orden: z.number().optional(),
  principal: z.boolean().optional(),
  tipo: z.string().optional(),
  optionValue: mongoId.optional()
});

// El VALOR del atributo se valida dinámicamente en el servicio (contra su
// definición); aquí solo exigimos la forma { attribute, value }.
const attributeValueInput = z.object({
  attribute: mongoId,
  value: z.any()
});

const productOptionInput = z.object({
  option: mongoId,
  values: z.array(mongoId).optional()
});

const variantInput = z.object({
  sku: z.string().optional(), // requerido se valida en el servicio (create)
  optionValues: z.array(mongoId).optional(),
  composicion: z.string().optional(),
  stock: z.number().min(0).optional(),
  media: z.array(mediaInput).optional(),
  activo: z.boolean().optional()
});

const productCreateSchema = z.object({
  nombre: z.string().min(1, 'El nombre es obligatorio'),
  sku: z.string().min(1, 'El SKU es obligatorio'),
  slug: z.string().optional(),
  descripcion: z.string().optional(),
  brand: mongoId,
  brands: z.array(mongoId).optional(), // multi-marca; si no viene, el modelo lo siembra con [brand]
  skuAliases: z.array(z.object({ sku: z.string().min(1), brand: mongoId.optional() })).optional(),
  category: mongoId,
  sexo: z.array(z.enum(['hombre', 'mujer', 'unisex'])).min(1, 'Indica al menos un público'),
  attributes: z.array(attributeValueInput).optional(),
  features: z.array(mongoId).optional(),
  applications: z.array(mongoId).optional(),
  options: z.array(productOptionInput).optional(),
  variants: z.array(variantInput).optional(),
  sizeChart: mongoId.optional(),
  faq: z.array(z.object({ pregunta: z.string().min(1), respuesta: z.string().min(1) })).optional(),
  media: z.array(mediaInput).optional(),
  destacado: z.boolean().optional(),
  activo: z.boolean().optional()
});

const productUpdateSchema = productCreateSchema.partial();

module.exports = { productCreateSchema, productUpdateSchema };
