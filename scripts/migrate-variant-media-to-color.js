/**
 * Migra las imágenes que hoy viven en `variant.media` (una por cada
 * combinación color+talla) hacia `product.media`, etiquetadas con
 * `optionValue` = el color de esa variante. A partir de este cambio, las
 * fotos se suben UNA vez por color (ver MediaManager.jsx /
 * product.controller.js#addImages) y se comparten entre todas sus tallas.
 *
 * No borra `variant.media` por defecto (queda como respaldo, ya no se lee
 * salvo que un producto no tenga nada migrado a product.media todavía — ver
 * ProductoDetalle.jsx). Pasa --clear para vaciarlo después de verificar que
 * todo se ve bien.
 *
 * Idempotente: no duplica imágenes ya presentes en product.media (compara
 * por public_id).
 *
 *   node scripts/migrate-variant-media-to-color.js            # dry-run (no escribe nada)
 *   node scripts/migrate-variant-media-to-color.js --apply     # escribe los cambios
 *   node scripts/migrate-variant-media-to-color.js --apply --clear  # además vacía variant.media migrado
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const CLEAR = process.argv.includes('--clear');

function isColorOption(opt) {
  if (!opt) return false;
  return opt.tipo === 'swatch' || /color/i.test(opt.slug || '') || /color/i.test(opt.nombre || '');
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const products = mongoose.connection.collection('products');
  const options = mongoose.connection.collection('options');

  const optionDocs = await options.find({}).toArray();
  const optionById = new Map(optionDocs.map((o) => [String(o._id), o]));

  const all = await products.find({ 'variants.media.0': { $exists: true } }).toArray();
  console.log(`Productos con imágenes en variant.media: ${all.length}${APPLY ? '' : ' (dry-run, no se escribe nada)'}\n`);

  let productosTocados = 0;
  let imagenesMigradas = 0;
  let imagenesDuplicadas = 0;

  for (const product of all) {
    const colorEntry = (product.options || []).find((o) => isColorOption(optionById.get(String(o.option))));
    if (!colorEntry) {
      console.warn(`  ⚠ ${product.nombre} (${product.sku}): no se detectó eje de color, se omite`);
      continue;
    }
    const colorValueIds = new Set((colorEntry.values || []).map(String));

    const existingPublicIds = new Set((product.media || []).map((m) => m.public_id));
    const nuevasMedia = [];
    let variantesConMedia = 0;

    for (const variant of product.variants || []) {
      if (!variant.media || variant.media.length === 0) continue;
      const colorId = (variant.optionValues || []).map(String).find((id) => colorValueIds.has(id));
      if (!colorId) {
        console.warn(`  ⚠ ${product.nombre}: variante ${variant.sku || variant._id} sin color reconocible, se omite su media`);
        continue;
      }
      variantesConMedia++;
      for (const m of variant.media) {
        if (existingPublicIds.has(m.public_id)) { imagenesDuplicadas++; continue; }
        existingPublicIds.add(m.public_id);
        nuevasMedia.push({ ...m, optionValue: new mongoose.Types.ObjectId(colorId) });
      }
    }

    if (nuevasMedia.length === 0) continue;
    productosTocados++;
    imagenesMigradas += nuevasMedia.length;
    console.log(`  ${product.nombre} (${product.sku}): +${nuevasMedia.length} imágenes desde ${variantesConMedia} variante(s)`);

    if (APPLY) {
      const update = { $push: { media: { $each: nuevasMedia } } };
      if (CLEAR) update.$set = { 'variants.$[].media': [] };
      await products.updateOne({ _id: product._id }, update);
    }
  }

  console.log(`\nResumen: ${productosTocados} productos, ${imagenesMigradas} imágenes migradas, ${imagenesDuplicadas} ya existían (omitidas).`);
  if (!APPLY) console.log('Dry-run: nada se escribió. Corre con --apply para aplicar.');

  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
