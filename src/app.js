const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');

const corsOptions = require('./config/cors');
const sanitize = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimit');
const swaggerSpec = require('./docs/swagger');
const productRoutes = require('./routes/product.routes');
const brandRoutes = require('./routes/brand.routes');
const categoryRoutes = require('./routes/category.routes');
const authRoutes = require('./routes/auth.routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

// Configura la aplicación Express (middlewares + rutas), pero NO la arranca.
// El arranque (conexión a Mongo + listen) vive en server.js.
const app = express();

app.use(express.json());
app.use(cors(corsOptions)); // whitelist desde ALLOWED_ORIGINS (resuelve C-5)

// Documentación Swagger — se monta ANTES de helmet (su CSP rompería la UI) y
// antes del rate-limit (para no limitar la carga de la interfaz).
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'API Catálogo · Docs' }));
app.get('/api/v1/docs.json', (req, res) => res.json(swaggerSpec));

app.use(helmet());
app.use(sanitize); // anti NoSQL-injection

// Nota: las imágenes ahora viven en Cloudinary (Etapa D). Ya no se sirven
// archivos locales, así que se eliminó el static /uploads y su parche de CORP (I-7).

app.get('/', (req, res) => {
  res.send('API de Catálogo de Productos Funcionando 🚀');
});

// Endpoint de salud para verificar que la API responde sin tocar la base de datos.
app.get('/api/v1/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

// Límite de peticiones para toda la API.
app.use('/api', apiLimiter);

// Rutas del catálogo (versionadas).
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/brands', brandRoutes);
app.use('/api/v1/categories', categoryRoutes);

// 404 uniforme para rutas no encontradas + manejo de errores central.
// Deben ir DESPUÉS de todas las rutas.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
