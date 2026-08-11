const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');

// Sube un buffer (imagen en memoria, de multer memoryStorage) a Cloudinary.
// Devuelve el resultado con secure_url y public_id.
function uploadBuffer(buffer, folder, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', ...options },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// Borra una imagen de Cloudinary por su public_id.
async function destroy(publicId) {
  return cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

// Verifica que haya credenciales antes de intentar subir, con un error claro.
function ensureConfigured() {
  if (!cloudinary.isConfigured()) {
    throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED',
      'Cloudinary no está configurado. Añade CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en .env');
  }
}

module.exports = { uploadBuffer, destroy, ensureConfigured };
