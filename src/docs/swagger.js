const swaggerJsdoc = require('swagger-jsdoc');

// Respuestas y esquemas reutilizables
const errorSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string' },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'PRODUCT_NOT_FOUND' },
        fields: { type: 'object', additionalProperties: { type: 'string' } }
      }
    }
  }
};

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'API Catálogo Multi-Marca',
    version: '1.0.0',
    description:
      'API centralizada de catálogo de productos multi-marca y multi-sitio.\n\n' +
      'Lectura pública; la escritura requiere token JWT de administrador ' +
      '(botón **Authorize** con el token de `POST /auth/login`).'
  },
  servers: [{ url: '/api/v1', description: 'Base v1' }],
  tags: [
    { name: 'Auth', description: 'Autenticación de administrador' },
    { name: 'Products', description: 'Catálogo de productos' },
    { name: 'Brands', description: 'Marcas / sitios' },
    { name: 'Categories', description: 'Categorías y subcategorías' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    },
    schemas: {
      Error: errorSchema,
      Image: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          public_id: { type: 'string' },
          alt: { type: 'string' },
          orden: { type: 'integer' },
          principal: { type: 'boolean' }
        }
      },
      Variant: {
        type: 'object',
        required: ['color'],
        properties: {
          sku: { type: 'string' },
          color: { type: 'string', example: 'Negro' },
          colorHex: { type: 'string', example: '#000000' },
          tallas: { type: 'array', items: { type: 'string' }, example: ['S', 'M', 'L'] },
          imagenes: { type: 'array', items: { $ref: '#/components/schemas/Image' } },
          principal: { type: 'boolean' }
        }
      },
      Product: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          nombre: { type: 'string' },
          sku: { type: 'string' },
          slug: { type: 'string' },
          descripcion: { type: 'string' },
          brand: { $ref: '#/components/schemas/BrandRef' },
          category: { $ref: '#/components/schemas/BrandRef' },
          sexo: { type: 'string', enum: ['hombre', 'mujer', 'unisex'] },
          aplicaciones: { type: 'array', items: { type: 'string', enum: ['bordado', 'dtf', 'vinil', 'sublimado'] } },
          variants: { type: 'array', items: { $ref: '#/components/schemas/Variant' } },
          activo: { type: 'boolean' }
        }
      },
      BrandRef: {
        type: 'object',
        properties: { _id: { type: 'string' }, nombre: { type: 'string' }, slug: { type: 'string' } }
      },
      ProductInput: {
        type: 'object',
        required: ['nombre', 'sku', 'brand', 'category', 'sexo'],
        properties: {
          nombre: { type: 'string', example: 'Playera Polo Piqué' },
          sku: { type: 'string', example: 'POL-001' },
          descripcion: { type: 'string' },
          brand: { type: 'string', description: 'ObjectId de la marca', example: '6a7b64e01af643be70d006a1' },
          category: { type: 'string', description: 'ObjectId de la categoría' },
          subcategory: { type: 'string' },
          linea: { type: 'string' },
          sexo: { type: 'string', enum: ['hombre', 'mujer', 'unisex'] },
          aplicaciones: { type: 'array', items: { type: 'string', enum: ['bordado', 'dtf', 'vinil', 'sublimado'] } },
          variants: { type: 'array', items: { $ref: '#/components/schemas/Variant' } },
          activo: { type: 'boolean' }
        }
      },
      Brand: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          nombre: { type: 'string' },
          slug: { type: 'string' },
          dominio: { type: 'string' },
          activo: { type: 'boolean' }
        }
      },
      BrandInput: {
        type: 'object',
        required: ['nombre'],
        properties: {
          nombre: { type: 'string', example: 'FitBeFresh' },
          slug: { type: 'string', description: 'Opcional; se autogenera del nombre' },
          dominio: { type: 'string', example: 'fitbefresh.com' },
          activo: { type: 'boolean' }
        }
      },
      Category: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          nombre: { type: 'string' },
          slug: { type: 'string' },
          parent: { type: 'string', nullable: true },
          orden: { type: 'integer' },
          activo: { type: 'boolean' }
        }
      },
      CategoryInput: {
        type: 'object',
        required: ['nombre'],
        properties: {
          nombre: { type: 'string', example: 'Playeras' },
          parent: { type: 'string', nullable: true, description: 'ObjectId de la categoría padre (subcategoría)' },
          orden: { type: 'integer' },
          activo: { type: 'boolean' }
        }
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 100 },
          totalPages: { type: 'integer', example: 5 }
        }
      },
      LoginInput: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password' }
        }
      }
    },
    responses: {
      Unauthorized: { description: 'Falta token o es inválido', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      Forbidden: { description: 'Requiere rol admin', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      NotFound: { description: 'No encontrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      ValidationError: { description: 'Datos inválidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
    }
  },
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Iniciar sesión (obtener token JWT)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } } },
        responses: {
          200: { description: 'Token emitido' },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' }
        }
      }
    },
    '/products': {
      get: {
        tags: ['Products'],
        summary: 'Listar productos (filtros + búsqueda + paginación)',
        parameters: [
          { name: 'brand', in: 'query', schema: { type: 'string' }, description: 'Slug de marca (ej. fitbefresh)' },
          { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Slug de categoría' },
          { name: 'subcategory', in: 'query', schema: { type: 'string' } },
          { name: 'sexo', in: 'query', schema: { type: 'string', enum: ['hombre', 'mujer', 'unisex'] } },
          { name: 'color', in: 'query', schema: { type: 'string' } },
          { name: 'talla', in: 'query', schema: { type: 'string' } },
          { name: 'aplicacion', in: 'query', schema: { type: 'string', enum: ['bordado', 'dtf', 'vinil', 'sublimado'] } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Búsqueda de texto (nombre/descripción/sku)' },
          { name: 'activo', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Ej. -createdAt,nombre' }
        ],
        responses: {
          200: {
            description: 'Lista paginada',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
                    pagination: { $ref: '#/components/schemas/Pagination' }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['Products'],
        summary: 'Crear producto',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductInput' } } } },
        responses: {
          201: { description: 'Creado' },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { description: 'SKU o slug duplicado' }
        }
      }
    },
    '/products/{id}': {
      get: {
        tags: ['Products'],
        summary: 'Obtener producto por ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { $ref: '#/components/responses/NotFound' } }
      },
      patch: {
        tags: ['Products'],
        summary: 'Actualizar producto (parcial)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductInput' } } } },
        responses: { 200: { description: 'Actualizado' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } }
      },
      delete: {
        tags: ['Products'],
        summary: 'Eliminar producto (soft por defecto; ?hard=true físico)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'hard', in: 'query', schema: { type: 'boolean' }, description: 'true = borrado físico + imágenes en Cloudinary' }
        ],
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    },
    '/products/slug/{slug}': {
      get: {
        tags: ['Products'],
        summary: 'Obtener producto por slug',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    },
    '/products/sku/{sku}': {
      get: {
        tags: ['Products'],
        summary: 'Obtener producto por SKU',
        parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    },
    '/products/{id}/images': {
      post: {
        tags: ['Products'],
        summary: 'Subir imágenes a una variante (multipart)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  imagenes: { type: 'array', items: { type: 'string', format: 'binary' } },
                  color: { type: 'string', description: 'Color de la variante destino' },
                  variantId: { type: 'string', description: 'Alternativa: _id de la variante' }
                }
              }
            }
          }
        },
        responses: { 201: { description: 'Subidas' }, 400: { $ref: '#/components/responses/ValidationError' }, 401: { $ref: '#/components/responses/Unauthorized' } }
      },
      delete: {
        tags: ['Products'],
        summary: 'Borrar una imagen (también de Cloudinary)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'public_id', in: 'query', required: true, schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    },
    '/brands': {
      get: { tags: ['Brands'], summary: 'Listar marcas', responses: { 200: { description: 'OK' } } },
      post: {
        tags: ['Brands'],
        summary: 'Crear marca',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/BrandInput' } } } },
        responses: { 201: { description: 'Creada' }, 401: { $ref: '#/components/responses/Unauthorized' }, 409: { description: 'Slug duplicado' } }
      }
    },
    '/brands/{slug}': {
      get: {
        tags: ['Brands'],
        summary: 'Obtener marca por slug',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    },
    '/brands/{id}': {
      patch: {
        tags: ['Brands'],
        summary: 'Actualizar marca (por ID)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/BrandInput' } } } },
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } }
      },
      delete: {
        tags: ['Brands'],
        summary: 'Desactivar marca (soft delete, por ID)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    },
    '/categories': {
      get: {
        tags: ['Categories'],
        summary: 'Listar categorías',
        parameters: [{ name: 'parent', in: 'query', schema: { type: 'string' }, description: 'ObjectId del padre, o "null" para raíces' }],
        responses: { 200: { description: 'OK' } }
      },
      post: {
        tags: ['Categories'],
        summary: 'Crear categoría',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CategoryInput' } } } },
        responses: { 201: { description: 'Creada' }, 401: { $ref: '#/components/responses/Unauthorized' }, 409: { description: 'Slug duplicado' } }
      }
    },
    '/categories/{slug}': {
      get: {
        tags: ['Categories'],
        summary: 'Obtener categoría por slug',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    },
    '/categories/{id}': {
      patch: {
        tags: ['Categories'],
        summary: 'Actualizar categoría (por ID)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CategoryInput' } } } },
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } }
      },
      delete: {
        tags: ['Categories'],
        summary: 'Desactivar categoría (soft delete, por ID)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } }
      }
    }
  }
};

// swagger-jsdoc permite además ampliar la doc con comentarios @openapi en las
// rutas en el futuro; hoy toda la spec vive en `definition`.
const swaggerSpec = swaggerJsdoc({ definition, apis: [] });

module.exports = swaggerSpec;
