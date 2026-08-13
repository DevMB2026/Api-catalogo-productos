/**
 * FASE 2+3 de la migración de imágenes a Cloudinary.
 * Lee data/prezenza-images-map.json, descarga cada imagen de prezenza.com (con
 * cabeceras de navegador, si no da 404) y la sube a Cloudinary con un public_id
 * DETERMINISTA (idempotente: re-correr no duplica). Luego asocia las imágenes de
 * cada color al variant.media de sus variantes, y la galería al product.media.
 *
 *   # PRUEBA: sube 1 producto a una carpeta de prueba, sin tocar la DB
 *   node scripts/migrate-images-cloudinary.js --only=playera-cotton --folder=catalogo-test --no-db
 *
 *   # REAL: todo el catálogo, carpeta definitiva, y actualiza la DB
 *   node scripts/migrate-images-cloudinary.js --folder=catalogo --write-db
 *
 * Flags: --only=slug,slug  --folder=NOMBRE  --no-db | --write-db  --limit=N
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const cloudinary = require('../src/config/cloudinary');
const { uploadBuffer } = require('../src/services/cloudinary.service');

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; };
const FOLDER = arg('folder', 'catalogo');
const ONLY = arg('only', null) ? new Set(arg('only').split(',')) : null;
const LIMIT = arg('limit', null) ? parseInt(arg('limit'), 10) : null;
const WRITE_DB = process.argv.includes('--write-db') && !process.argv.includes('--no-db');

const MAP = arg('map', null) ? path.resolve(arg('map')) : path.join(__dirname, '..', 'data', 'prezenza-images-map.json');
const CACHE = path.join(__dirname, '..', 'data', 'cloudinary-uploads.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf-8')) : {};
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
// Sanea cada segmento del public_id (algunos SKUs traen espacios, ":" y "/").
// Preserva mayúsculas para no invalidar los public_id ya subidos con SKU limpio.
const seg = (s) => String(s || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const pid = (brand, sku, sig) => `${FOLDER}/${seg(brand) || 'sin-marca'}/${seg(sku) || 'sku'}/${seg(sig)}`;

async function download(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Referer: 'https://prezenza.com/', Accept: 'image/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

// Sube una imagen (o la toma del caché). Devuelve { url, public_id }.
async function upOne(brand, sku, item) {
  const public_id = pid(brand, sku, item.sig);
  if (cache[public_id]) return { url: cache[public_id], public_id };
  let buf;
  try { buf = await download(item.src); }
  catch (e) { console.log(`    ! descarga falló (${e.message}) ${item.src.split('/').pop()}`); return null; }
  try {
    const r = await uploadBuffer(buf, undefined, { public_id, overwrite: true, resource_type: 'image' });
    cache[public_id] = r.secure_url;
    return { url: r.secure_url, public_id };
  } catch (e) { console.log(`    ! subida falló (${e.message}) ${item.sig}`); return null; }
}

async function main() {
  if (!cloudinary.isConfigured()) { console.error('Cloudinary no configurado (.env).'); process.exit(1); }
  console.log(`\n=== MIGRACIÓN DE IMÁGENES → Cloudinary "${FOLDER}/" ${WRITE_DB ? '(+DB)' : '(sin DB)'} ${ONLY ? '· only=' + [...ONLY] : ''} ===\n`);

  let productos = JSON.parse(fs.readFileSync(MAP, 'utf-8')).products;
  if (ONLY) productos = productos.filter((p) => ONLY.has(p.slug));
  if (LIMIT) productos = productos.slice(0, LIMIT);

  // Modelos + conexión solo si vamos a escribir en la DB.
  let Product, Option, OptionValue, colorOptId;
  if (WRITE_DB) {
    Product = require('../src/models/product.model');
    Option = require('../src/models/option.model');
    OptionValue = require('../src/models/optionValue.model');
    await mongoose.connect(process.env.MONGO_URI);
    const co = await Option.findOne({ slug: 'color' });
    colorOptId = co && co._id;
  }

  let subidas = 0, saltadas = 0, fallidas = 0;
  for (const p of productos) {
    console.log(`\n▸ ${p.slug} (${p.sku})`);
    // Sube imágenes por color y galería; guarda resultados por color/galería.
    const colorMedia = {}; // colorSlug -> [{url, public_id}]
    for (const [color, items] of Object.entries(p.colors || {})) {
      colorMedia[color] = [];
      for (const it of items) {
        const before = cache[pid(p.brandSlug, p.sku, it.sig)];
        const r = await upOne(p.brandSlug, p.sku, it); // eslint-disable-line no-await-in-loop
        if (!r) { fallidas++; continue; }
        colorMedia[color].push(r);
        before ? saltadas++ : subidas++;
      }
      console.log(`  ${color.padEnd(14)} ${colorMedia[color].length} img`);
    }
    const galleryMedia = [];
    for (const it of p.gallery || []) {
      const before = cache[pid(p.brandSlug, p.sku, it.sig)];
      const r = await upOne(p.brandSlug, p.sku, it); // eslint-disable-line no-await-in-loop
      if (!r) { fallidas++; continue; }
      galleryMedia.push(r); before ? saltadas++ : subidas++;
    }
    console.log(`  gallery        ${galleryMedia.length} img`);
    saveCache();

    if (!WRITE_DB) continue;

    // --- Asociar a variantes (por color) y a product.media (galería) ---
    const prod = await Product.findOne({ slug: p.slug });
    if (!prod) { console.log('  · no está en la DB, salto asociación'); continue; }
    const toMedia = (arr) => arr.map((m, i) => ({ url: m.url, public_id: m.public_id, orden: i, principal: i === 0, tipo: 'image' }));

    // resolver color de cada variante: su OptionValue cuyo option == Color
    const valIds = [...new Set(prod.variants.flatMap((v) => v.optionValues.map(String)))];
    const vals = await OptionValue.find({ _id: { $in: valIds } }).select('_id slug option');
    const slugById = new Map(vals.map((v) => [String(v._id), String(v.option) === String(colorOptId) ? v.slug : null]));

    for (const v of prod.variants) {
      const colorSlug = v.optionValues.map((id) => slugById.get(String(id))).find(Boolean);
      const imgs = colorSlug && colorMedia[colorSlug] ? colorMedia[colorSlug] : [];
      v.media = toMedia(imgs);
    }
    prod.media = toMedia(galleryMedia);
    await prod.save();
    console.log(`  ✓ DB: ${prod.variants.length} variantes + ${galleryMedia.length} en galería`);
  }

  saveCache();
  console.log(`\n=== RESUMEN ===`);
  console.log(`Subidas nuevas: ${subidas} | reutilizadas (caché): ${saltadas} | fallidas: ${fallidas}`);
  console.log(`Caché: ${path.relative(process.cwd(), CACHE)} (${Object.keys(cache).length} imágenes)`);
  if (WRITE_DB) await mongoose.disconnect();
  else console.log('\nSin --write-db: no se tocó la base de datos (solo se subió a Cloudinary).');
}

main().catch((e) => { console.error('Error:', e); saveCache(); process.exit(1); });
