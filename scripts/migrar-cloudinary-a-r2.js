/**
 * Migra las imágenes de los productos de Cloudinary a Cloudflare R2.
 * Por cada media (galería del producto y de cada variante) con URL de Cloudinary:
 * descarga la imagen, la convierte a WebP (máx. 1600 px), la sube a R2 con la
 * misma ruta (public_id) y actualiza media.url. NO borra nada de Cloudinary.
 * Es idempotente: lo ya migrado (URL ya en R2) se salta.
 *
 *   # SIMULACIÓN (por defecto): no sube ni escribe nada, solo cuenta
 *   node scripts/migrar-cloudinary-a-r2.js
 *
 *   # PRUEBA: sube 10 imágenes a R2 y actualiza la DB solo de esas
 *   node scripts/migrar-cloudinary-a-r2.js --write --limit=10
 *
 *   # TODO
 *   node scripts/migrar-cloudinary-a-r2.js --write
 *
 * Requiere en .env: MONGO_URI y R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL.
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const { toWebp, r2, r2Configured, publicUrl } = require('../src/services/storage.service');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const WRITE = process.argv.includes('--write');
const limArg = process.argv.find((x) => x.startsWith('--limit='));
const LIMIT = limArg ? parseInt(limArg.split('=')[1], 10) : Infinity;

const isCloudinary = (u) => typeof u === 'string' && u.includes('res.cloudinary.com');

async function download(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

async function main() {
  if (WRITE && !r2Configured()) throw new Error('Faltan variables R2_* en .env');
  await mongoose.connect(process.env.MONGO_URI);
  const products = await Product.find({});
  const stats = { vistas: 0, aMigrar: 0, migradas: 0, saltadas: 0, errores: 0, bytesAntes: 0, bytesDespues: 0 };
  let procesadas = 0;

  for (const product of products) {
    const grupos = [product.media, ...product.variants.map((v) => v.media)];
    let cambio = false;
    for (const arr of grupos) {
      for (const m of arr || []) {
        stats.vistas++;
        if (!isCloudinary(m.url)) { stats.saltadas++; continue; }
        stats.aMigrar++;
        if (!WRITE || procesadas >= LIMIT) continue;
        try {
          const original = await download(m.url);
          const webp = await toWebp(original);
          await r2().send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: `${m.public_id}.webp`,
            Body: webp,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable'
          }));
          m.url = publicUrl(m.public_id);
          cambio = true;
          procesadas++;
          stats.migradas++;
          stats.bytesAntes += original.length;
          stats.bytesDespues += webp.length;
          console.log(`  ok  ${m.public_id}  ${(original.length / 1024).toFixed(0)}KB -> ${(webp.length / 1024).toFixed(0)}KB`);
        } catch (e) {
          stats.errores++;
          console.log(`  !!  ${m.public_id}: ${e.message}`);
        }
      }
    }
    if (cambio) { product.markModified('media'); product.markModified('variants'); await product.save(); }
  }

  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  console.log('\n=== Resumen ===');
  console.log(WRITE ? 'MODO ESCRITURA' : 'SIMULACIÓN (no se escribió nada; usa --write)');
  console.log(stats, WRITE ? `\nPeso: ${mb(stats.bytesAntes)} -> ${mb(stats.bytesDespues)}` : '');
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
