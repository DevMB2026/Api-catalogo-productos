const multer = require('multer');
const AppError = require('../utils/AppError');

// Guarda el archivo en memoria (buffer), NO en disco: desde ahí lo subimos
// directo a Cloudinary. Esto elimina el almacenamiento local (bug C-2/I-7).
const storage = multer.memoryStorage();

// Solo imágenes.
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new AppError(400, 'INVALID_FILE_TYPE', 'Solo se permiten archivos de imagen'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB por imagen
});

module.exports = upload;
