# Arquitectura — API Centralizada de Catálogo Multi-Marca

> Documento de diseño (Fases 2–6). No modifica código. Es la referencia acordada antes de implementar.
> Decisiones confirmadas: Brand+Category como colecciones · Cloudinary · JWT+rol admin · Zod · `/api/v1` · Swagger.

---

## Fase 2 — Modelo de datos

### Regla de decisión: ¿colección separada o embebido?

- **Colección separada** cuando la entidad se comparte entre muchos productos, se administra por su cuenta y se consulta sola → **Brand**, **Category**, **User** (admin).
- **Embebido (subdocumento)** cuando no tiene vida propia, siempre se accede junto al producto y su tamaño es acotado → **variaciones, imágenes, aplicaciones, tabla de medidas, FAQ**.

No creamos `Application`, `Variation` ni `Image` como colecciones: no tienen ciclo de vida independiente y siempre viajan con el producto. Embeberlos = una sola consulta y actualizaciones atómicas.

### Colección `Brand`
```js
{
  nombre:  String,   // "FitBeFresh"          (required)
  slug:    String,   // "fitbefresh"          (unique, index, required)
  dominio: String,   // "fitbefresh.com"      (referencia para CORS/consumo)
  logo:    { url: String, public_id: String },
  activo:  Boolean,  // default true
  // timestamps
}
```

### Colección `Category`
```js
{
  nombre: String,    // "Playeras" / "Polo"   (required)
  slug:   String,    // "playeras" / "polo"   (unique, index)
  parent: ObjectId,  // ref Category | null   (null = categoría raíz; con valor = subcategoría)
  orden:  Number,    // para ordenar en menús
  activo: Boolean,   // default true
  // timestamps
}
```
`parent` cubre **Categoría → Subcategoría** sin necesidad de dos colecciones. `linea` (Corporativa, Outdoor…) va como campo/tag en el producto: es agrupación de marketing, no requiere colección propia todavía.

### Colección `Product`
```js
{
  nombre:      String,    // required
  sku:         String,    // required, unique, index  (id de negocio base)
  slug:        String,    // unique, index  (autogenerado de nombre+sku con slugify)
  descripcion: String,

  brand:       ObjectId,  // ref Brand      (required, index)
  category:    ObjectId,  // ref Category   (required, index)
  subcategory: ObjectId,  // ref Category   (opcional; su parent = category)
  linea:       String,    // opcional, tag  ("Corporativa", "Outdoor"...)

  sexo:        String,    // enum ['hombre','mujer','unisex']  (required)

  tela: {
    material:    String,  // "Algodón"
    composicion: String,  // "60% algodón, 40% poliéster"
    tipo:        String,  // "Piqué"
    peso:        String,  // "180 g/m²"
    cuidados:    [String] // ["No usar cloro", "Lavar en frío"]
  },

  aplicaciones: [String], // enum ['bordado','dtf','vinil','sublimado']  (index)

  atributos: Map,         // opcional y flexible (Be Fresh Security y otros):
                          // { altaVisibilidad: true, cintaReflejante: true, tipoCinta: "..." }

  variants: [Variant],    // ver abajo (subdocumento)

  sizeGuide: [Medida],    // tabla de medidas (subdocumento)
  faq:       [FAQ],       // preguntas frecuentes (subdocumento)
  infoAdicional: String,  // texto libre para lo no estructurado

  destacado: Boolean,     // default false
  activo:    Boolean,     // default true, index
  // timestamps
}
```

### Subdocumentos
```js
// Variant  — relaciona color ↔ tallas ↔ imágenes (punto 11 del brief)
{
  sku:       String,   // sku de la variante (recomendado)
  color:     String,   // "Negro"           (required)
  colorHex:  String,   // "#000000"
  tallas:    [String], // ["S","M","L","XL"]  → evolucionable a [{talla, stock, disponible}]
  imagenes:  [Image],
  principal: Boolean   // variante por defecto del producto
}

// Image
{
  url:       String,   // secure_url de Cloudinary   (required)
  public_id: String,   // para poder borrarla en Cloudinary (required)
  alt:       String,
  orden:     Number,   // default 0
  principal: Boolean   // imagen principal de la variante
}

// Medida  — flexible pero con tipos (mejora sobre Mixed)
{
  talla:   String,     // "M"  (required)
  medidas: Map<Number> // { pecho: 52, largo: 70, hombros: 44 }  → columnas según prenda
}

// FAQ
{ pregunta: String, respuesta: String }
```

### Índices
- `Product`: `sku` (unique), `slug` (unique), `brand`, `category`, `activo`, `aplicaciones`.
- Índice compuesto para el filtro más común: `{ brand: 1, category: 1, activo: 1 }`.
- Índice de texto para búsqueda: `{ nombre: 'text', descripcion: 'text', sku: 'text' }`.
- `Brand.slug` y `Category.slug`: unique.

### Preparado para inventario (sin implementarlo)
`variants[].tallas` (hoy `[String]`) puede migrar a `[{ talla, stock, disponible }]` sin romper el resto del modelo. Esa es la única puerta que dejamos abierta.

---

## Fase 3 — Endpoints

### Públicos (lectura)
```
GET  /api/v1/products
GET  /api/v1/products/:id
GET  /api/v1/products/slug/:slug
GET  /api/v1/products/sku/:sku
GET  /api/v1/brands
GET  /api/v1/brands/:slug
GET  /api/v1/categories
```

### Privados (JWT + rol admin)
```
POST   /api/v1/auth/login

POST   /api/v1/products
PATCH  /api/v1/products/:id
DELETE /api/v1/products/:id
POST   /api/v1/products/:id/images        # subir imágenes a una variante
DELETE /api/v1/products/:id/images/:public_id

POST   /api/v1/brands       PATCH /api/v1/brands/:id       DELETE /api/v1/brands/:id
POST   /api/v1/categories   PATCH /api/v1/categories/:id   DELETE /api/v1/categories/:id
```

### Query params de `GET /products`
`brand` (slug) · `category` (slug) · `subcategory` · `linea` · `sexo` · `color` · `talla` · `aplicacion` · `activo` · `sku` · `slug` · `q` (búsqueda de texto) · `page` · `limit` · `sort`

### Respuesta paginada (tu formato, punto 19)
```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

### Borrado: soft delete por defecto
`DELETE /products/:id` marca `activo: false` (seguro, conserva referencias e historial). El borrado físico (y de imágenes en Cloudinary) solo con una acción explícita. Evita perder datos por un clic.

---

## Fase 4 — Imágenes (Cloudinary)

```
Frontend (multipart/form-data)
        │
        ▼
API  →  multer memoryStorage (buffer en RAM, sin tocar disco)
        │
        ▼
cloudinary.uploader.upload_stream(buffer, { folder: `catalogo/<brandSlug>/<sku>` })
        │
        ▼
{ secure_url, public_id }  →  se guarda en variant.imagenes[]  →  MongoDB
```

- **Sin disco local**: elimina el bug de `uploads` y el parche de CORP en Helmet.
- **Borrado sin huérfanas**: al quitar una imagen o borrar físicamente un producto → `cloudinary.uploader.destroy(public_id)`.
- **Tamaños/optimización**: no guardamos múltiples versiones. Cloudinary transforma por URL bajo demanda (`.../w_400,q_auto,f_auto/...`). Un solo `public_id`, muchos tamaños.
- **Organización**: carpeta por marca y SKU para mantenimiento claro.

Variables `.env`: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

---

## Fase 5 — Seguridad

```
Lectura  (GET)                 →  público  +  rate limit  (API key opcional a futuro)
Escritura(POST/PATCH/DELETE)   →  JWT válido con rol "admin"
```

- **CORS**: whitelist desde `ALLOWED_ORIGINS` (lista separada por comas en `.env`). Nada de `cors()` abierto.
- **Helmet**: se mantiene; ya no hace falta el parche de `crossOriginResourcePolicy` (imágenes en Cloudinary).
- **Rate limiting**: `express-rate-limit` global (p. ej. 100 req/15 min) + límite más estricto en `/auth/login`.
- **NoSQL injection**: `express-mongo-sanitize` para limpiar `$` y `.` de las entradas.
- **JWT**: login de admin emite token (`role: admin`); middleware `auth` verifica en rutas de escritura. Password con `bcrypt`. Colección `User` (o admin sembrado). Token en `Authorization: Bearer`.
- **Validación**: Zod en toda entrada de escritura (Fase 6).
- **Secretos**: solo en `.env` → `MONGO_URI`, `JWT_SECRET`, `CLOUDINARY_*`, `ALLOWED_ORIGINS`. `.env` ya está en `.gitignore` (correcto).

---

## Fase 6 — Documentación y manejo de errores

### Errores (estructura uniforme, tu punto 25)
```json
{ "success": false, "message": "Producto no encontrado", "error": { "code": "PRODUCT_NOT_FOUND" } }
```
- Clase `AppError(statusCode, code, message)` + middleware central de errores.
- El `detalle` técnico (Mongo/Mongoose) **solo en logs del servidor**, nunca al cliente.
- Middleware `notFound` (404) para rutas desconocidas.
- Helper `asyncHandler` para no repetir try/catch en cada controlador.

### Swagger / OpenAPI
- `swagger-jsdoc` (anotaciones JSDoc en las rutas) + `swagger-ui-express` sirviendo `/api/v1/docs`.
- Documenta: endpoints, parámetros, respuestas, errores, modelos, `bearerAuth` (JWT) y ejemplos.
- Recomendación: docs accesibles en desarrollo; en producción, decidir si se protegen.

---

## Estructura de carpetas propuesta (proporcional, sin sobrearquitectura)
```
src/
├── config/       # db.js, cloudinary.js, cors.js, env.js
├── controllers/  # product, brand, category, auth
├── models/       # product.model.js, brand.model.js, category.model.js, user.model.js
├── routes/       # v1/index.js + product.routes.js, brand.routes.js, ...
├── middleware/   # auth.js, upload.js, errorHandler.js, notFound.js, rateLimit.js, validate.js
├── services/     # cloudinary.service.js, product.service.js
├── validators/   # product.schema.js (Zod), brand.schema.js, ...
├── utils/        # AppError.js, asyncHandler.js, slug.js, pagination.js
├── docs/         # swagger.js
├── app.js        # configura Express (sin arrancar)
└── server.js     # conecta Mongo y hace listen
```

## Dependencias a añadir (cada una justificada)
| Paquete | Para qué | Justificación |
|---|---|---|
| `cloudinary` | Imágenes en CDN | Multi-sitio necesita URLs servibles, no disco local |
| `jsonwebtoken` | Auth admin | Proteger escritura, escalable a clientes externos |
| `bcrypt` | Hash de password | Nunca guardar contraseñas en claro |
| `zod` | Validación de entrada | Una sola herramienta, fuente única de verdad |
| `express-rate-limit` | Límite de consumo | Requisito explícito (punto 17) |
| `express-mongo-sanitize` | Anti NoSQL-injection | Protección de MongoDB |
| `slugify` | Slugs limpios | Slugs únicos y consistentes |
| `swagger-jsdoc` + `swagger-ui-express` | Docs | Consumidores externos futuros |

**No** se añade (por ahora): Redis, colas, GraphQL, microservicios.
