const path = require('path');
const dns = require('dns');

// Fuerza DNS de Google porque el DNS por defecto de la red local no resuelve
// bien el registro SRV de mongodb+srv:// (error querySrv ECONNREFUSED).
// Workaround específico de este entorno; en un servidor cloud suele sobrar (ver M-6).
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = require('./app');
const connectDB = require('./config/db');
const cloudinary = require('./config/cloudinary');

const PORT = process.env.PORT || 4000;

async function startServer() {
  if (!process.env.MONGO_URI) {
    console.error('Falta MONGO_URI. Crea un archivo .env en la raíz del proyecto y agrega tu URI de MongoDB Atlas.');
    process.exit(1);
  }

  try {
    await connectDB(process.env.MONGO_URI);

    if (!cloudinary.isConfigured()) {
      console.warn('⚠  Cloudinary no configurado: la subida de imágenes fallará hasta añadir CLOUDINARY_* en .env');
    }
    if (!process.env.JWT_SECRET) {
      console.warn('⚠  JWT_SECRET no configurado: el login y las rutas de escritura fallarán hasta añadirlo en .env');
    }
    if (!process.env.ALLOWED_ORIGINS) {
      console.warn('⚠  ALLOWED_ORIGINS vacío: se bloqueará el acceso desde navegadores de otros dominios');
    }

    app.listen(PORT, () => {
      console.log(`Servidor corriendo en el puerto ${PORT}`);
    });
  } catch (error) {
    console.error('Error conectando a MongoDB:', error.message);
    process.exit(1);
  }
}

startServer();
