const { v2: cloudinary } = require('cloudinary');

// Configura Cloudinary desde variables de entorno. Las 3 claves se obtienen del
// dashboard de Cloudinary (Account Details) y van en .env, nunca en el código:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Indica si las credenciales están presentes (para avisar en el arranque).
cloudinary.isConfigured = () =>
  Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

module.exports = cloudinary;
