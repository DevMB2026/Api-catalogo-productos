// Almacenamiento de imágenes. Misma interfaz que cloudinary.service.js, así el
// controlador no cambia. El proveedor se elige con STORAGE_PROVIDER:
//   "cloudinary" (por defecto, comportamiento actual) | "r2" (Cloudflare R2)
//
// En R2 cada imagen se redimensiona (máx. 1600 px) y se guarda como WebP.
// public_id = ruta sin extensión (igual que en Cloudinary); la clave en el
// bucket es `${public_id}.webp`, y la URL pública `${R2_PUBLIC_URL}/${public_id}.webp`.
const crypto = require('crypto');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const cloudinaryService = require('./cloudinary.service');
const AppError = require('../utils/AppError');

const PROVIDER = (process.env.STORAGE_PROVIDER || 'cloudinary').toLowerCase();
const MAX_SIDE = 1600;
const WEBP_QUALITY = 82;

let client;
function r2() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return client;
}

function r2Configured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET && process.env.R2_PUBLIC_URL);
}

// Optimiza: respeta la orientación EXIF, no agranda, WebP.
function toWebp(buffer) {
  return sharp(buffer).rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

const publicUrl = (publicId) => `${process.env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${publicId}.webp`;

async function uploadBuffer(buffer, folder, options = {}) {
  if (PROVIDER !== 'r2') return cloudinaryService.uploadBuffer(buffer, folder, options);
  const publicId = options.public_id || `${folder}/${crypto.randomUUID()}`;
  const body = await toWebp(buffer);
  await r2().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: `${publicId}.webp`,
    Body: body,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable'
  }));
  return { secure_url: publicUrl(publicId), public_id: publicId, bytes: body.length };
}

async function destroy(publicId) {
  if (PROVIDER !== 'r2') return cloudinaryService.destroy(publicId);
  return r2().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: `${publicId}.webp` }));
}

function ensureConfigured() {
  if (PROVIDER !== 'r2') return cloudinaryService.ensureConfigured();
  if (!r2Configured()) {
    throw new AppError(503, 'R2_NOT_CONFIGURED',
      'R2 no está configurado. Añade R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET y R2_PUBLIC_URL');
  }
}

module.exports = { uploadBuffer, destroy, ensureConfigured, toWebp, r2, r2Configured, publicUrl, PROVIDER };
