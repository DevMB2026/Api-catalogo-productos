/**
 * Etiqueta como "de un color" las fotos que hoy viven sueltas en la galería
 * general (`product.media` sin `optionValue`), para el caso en que sea
 * inequívoco a qué color pertenecen: un producto donde exactamente UN color
 * no tiene ninguna foto propia todavía. Esas fotos sueltas casi siempre son,
 * de hecho, las de ese color (se subieron antes de que existiera el
 * concepto de "galería por color").
 *
 * Es un MOVIMIENTO, no una copia: a las fotos generales se les asigna
 * `optionValue` = el color huérfano, dejan de aparecer en "Galería general"
 * y pasan a aparecer bajo ese color.
 *
 * Si un producto tiene 2+ colores sin fotos propias, NO se toca (no hay
 * forma de adivinar cuál es cuál) — queda para revisión manual.
 *
 *   node scripts/migrate-general-media-to-orphan-color.js            # dry-run
 *   node scripts/migrate-general-media-to-orphan-color.js --apply     # aplica
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

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

  const all = await products.find({ 'media.0': { $exists: true } }).toArray();
  console.log(`Revisando ${all.length} productos con imágenes${APPLY ? '' : ' (dry-run, no se escribe nada)'}\n`);

  let tocados = 0;
  let imagenesMovidas = 0;

  for (const product of all) {
    const generalMedia = (product.media || []).filter((m) => !m.optionValue);
    if (generalMedia.length === 0) continue;

    const colorEntry = (product.options || []).find((o) => isColorOption(optionById.get(String(o.option))));
    if (!colorEntry) continue;

    const colorIds = (colorEntry.values || []).map(String);
    const orphans = colorIds.filter((cid) => !(product.media || []).some((m) => m.optionValue && String(m.optionValue) === cid));
    if (orphans.length !== 1) continue; // 0 = nada que mover, 2+ = ambiguo, se omite

    const orphanColorId = orphans[0];
    console.log(`  ${product.nombre} (${product.sku}): ${generalMedia.length} fotos generales -> color ${orphanColorId}`);
    tocados++;
    imagenesMovidas += generalMedia.length;

    if (APPLY) {
      await products.updateOne(
        { _id: product._id, 'media.public_id': { $in: generalMedia.map((m) => m.public_id) } },
        { $set: Object.fromEntries(generalMedia.map((_, i) => [`media.$[el${i}].optionValue`, new mongoose.Types.ObjectId(orphanColorId)])) },
        { arrayFilters: generalMedia.map((m, i) => ({ [`el${i}.public_id`]: m.public_id })) }
      );
    }
  }

  console.log(`\nResumen: ${tocados} productos, ${imagenesMovidas} imágenes movidas de la galería general a un color.`);
  if (!APPLY) console.log('Dry-run: nada se escribió. Corre con --apply para aplicar.');

  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
