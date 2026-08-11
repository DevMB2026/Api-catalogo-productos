# API Catálogo Multi-Marca

API centralizada de catálogo de productos multi-marca y multi-sitio. Una sola API + una sola base de datos (MongoDB) consumida por varios sitios web (FitBeFresh, Prezenza, La Casa de la Chamarra, La Casa de la Playera, Uniformes QRO, Uniformes MTY, Be Fresh Security).

## Stack

Node.js · Express 5 · MongoDB/Mongoose · JWT · Cloudinary · Zod · Swagger · Helmet · CORS · express-rate-limit

## Requisitos

- Node.js 18+
- Cuenta de MongoDB Atlas
- Cuenta de Cloudinary (para imágenes)

## Configuración

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Copia `.env.example` a `.env` y rellena los valores:
   ```bash
   cp .env.example .env
   ```
   Variables: `MONGO_URI`, `PORT`, `CLOUDINARY_*`, `JWT_SECRET`, `JWT_EXPIRES`, `ALLOWED_ORIGINS`.
3. Crea un usuario administrador:
   ```bash
   node scripts/create-admin.js tu-email@dominio.com TuPassword
   ```
4. Arranca el servidor:
   ```bash
   npm run dev   # con nodemon
   # o
   npm start
   ```

## Documentación

Con el servidor corriendo: **http://localhost:4000/api/v1/docs** (Swagger UI).
Especificación OpenAPI en `/api/v1/docs.json`.

## Endpoints principales

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/v1/auth/login` | público |
| GET | `/api/v1/products` | público (filtros, búsqueda, paginación) |
| GET | `/api/v1/products/:id` · `/slug/:slug` · `/sku/:sku` | público |
| POST/PATCH/DELETE | `/api/v1/products` | admin (JWT) |
| POST/DELETE | `/api/v1/products/:id/images` | admin (JWT) |
| GET | `/api/v1/brands` · `/api/v1/categories` | público |
| POST/PATCH/DELETE | `/api/v1/brands` · `/api/v1/categories` | admin (JWT) |

La lectura (`GET`) es pública; la escritura requiere token JWT de administrador en el header `Authorization: Bearer <token>`.

## Estructura

```
src/
├── config/       # db, cloudinary, cors
├── controllers/  # products, brands, categories, auth
├── models/       # product, brand, category, user
├── routes/       # rutas versionadas /api/v1
├── middleware/   # auth, upload, sanitize, rateLimit, validate, errorHandler, notFound
├── services/     # cloudinary
├── validators/   # esquemas Zod
├── docs/         # swagger
├── app.js        # configuración de Express
└── server.js     # arranque (conexión + listen)
scripts/          # create-admin, migrate-legacy-products
docs/ARQUITECTURA.md  # documento de diseño
```

## Seguridad

- Escritura protegida con JWT + rol admin.
- CORS restringido por `ALLOWED_ORIGINS`.
- Rate limiting, sanitización anti NoSQL-injection, Helmet.
- Los secretos viven solo en `.env` (nunca en el repositorio).
