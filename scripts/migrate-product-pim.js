/**
 * Migra los productos con la forma ANTIGUA al nuevo modelo dinámico (PIM).
 * Legados = documentos sin el campo `options` (la forma nueva siempre lo tiene).
 *
 *   node scripts/migrate-product-pim.js --dry-run   (previsualiza)
 *   node scripts/migrate-product-pim.js             (aplica)
 *
 * Conversión:
 *   variants[{color,tallas,imagenes}] -> Option Color/Talla + OptionValue +
 *       product.options + variants por COMBINATORIA (color × talla)
 *   imagenes de las variantes         -> product.media (galería)
 *   sizeGuide                         -> SizeChart (reutilizable) + product.sizeChart
 *   aplicaciones (texto)              -> Application refs
 *   infoAdicional                     -> se anexa a descripcion
 *   se eliminan: tela, atributos, sizeGuide, aplicaciones, infoAdicional, detalles
 * Idempotente: tras migrar, el doc tiene `options` y no se vuelve a tocar.
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const slugify = require('slugify');
const Option = require('../src/models/option.model');
const OptionValue = require('../src/models/optionValue.model');
const Application = require('../src/models/application.model');
const SizeChart = require('../src/models/sizeChart.model');

const DRY = process.argv.includes('--dry-run');
const slug = (s) => slugify(String(s), { lower: true, strict: true });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function findOrCreateOption(nombre, tipo) {
  const s = slug(nombre);
  let opt = await Option.findOne({ slug: s });
  if (!opt && !DRY) opt = await Option.create({ nombre, slug: s, tipo });
  return opt || { _id: '(dry)', slug: s, nombre };
}
async function findOrCreateValue(option, valor, meta) {
  const s = slug(valor);
  let v = await OptionValue.findOne({ option: option._id, slug: s });
  if (!v && !DRY) v = await OptionValue.create({ option: option._id, valor, slug: s, meta });
  return v || { _id: '(dry)', slug: s, valor };
}
async function findOrCreateApplication(nombre) {
  const s = slug(nombre);
  let a = await Application.findOne({ slug: s });
  if (!a && !DRY) a = await Application.create({ nombre, slug: s });
  return a;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Conectado. Modo: ${DRY ? 'DRY-RUN' : 'APLICAR'}\n`);
  const col = mongoose.connection.collection('products');
  const legacy = await col.find({ options: { $exists: false } }).toArray();
  console.log(`Productos legados: ${legacy.length}`);

  let migrados = 0;
  for (const old of legacy) {
    console.log(`\n--- "${old.nombre}" (${old.sku}) ---`);

    // Colores y tallas presentes en las variantes viejas
    const colores = [...new Set((old.variants || []).map((v) => v.color).filter(Boolean))];
    const tallas = [...new Set((old.variants || []).flatMap((v) => v.tallas || []))];

    // Options + valores
    const colorOpt = colores.length ? await findOrCreateOption('Color', 'swatch') : null;
    const tallaOpt = tallas.length ? await findOrCreateOption('Talla', 'size') : null;
    const colorVals = {};
    for (const c of colores) colorVals[c] = await findOrCreateValue(colorOpt, c);
    const tallaVals = {};
    for (const t of tallas) tallaVals[t] = await findOrCreateValue(tallaOpt, t);

    const options = [];
    if (colorOpt) options.push({ option: colorOpt._id, values: colores.map((c) => colorVals[c]._id) });
    if (tallaOpt) options.push({ option: tallaOpt._id, values: tallas.map((t) => tallaVals[t]._id) });

    // Variantes por combinatoria (color × talla)
    const variants = [];
    const composicion = (old.infoAdicional && /\d+%/.test(old.infoAdicional)) ? old.infoAdicional.split(',')[0].trim() : '';
    const colorList = colores.length ? colores : [null];
    const tallaList = tallas.length ? tallas : [null];
    for (const c of colorList) {
      for (const t of tallaList) {
        const ov = [];
        if (c) ov.push(colorVals[c]._id);
        if (t) ov.push(tallaVals[t]._id);
        const parts = [old.sku, c && slug(c), t && slug(t)].filter(Boolean).join('-').toUpperCase();
        variants.push({ sku: parts, optionValues: ov, composicion, price: 0, stock: 0, media: [], activo: true });
      }
    }

    // Media (galería del producto) desde las imágenes de las variantes viejas
    const media = [];
    for (const v of old.variants || []) for (const im of v.imagenes || []) {
      media.push({ url: im.url, public_id: im.public_id, orden: media.length, principal: media.length === 0, tipo: 'image' });
    }

    // SizeChart reutilizable desde sizeGuide
    let sizeChartId = null;
    if (Array.isArray(old.sizeGuide) && old.sizeGuide.length) {
      const cols = [];
      for (const row of old.sizeGuide) for (const k of Object.keys(row.medidas || {})) if (!cols.includes(k)) cols.push(k);
      const rows = old.sizeGuide.map((r) => ({ label: r.talla, values: cols.map((k) => (r.medidas && r.medidas[k] != null ? r.medidas[k] : 0)) }));
      const nombre = `${old.nombre} — medidas`;
      const scSlug = slug(nombre);
      let sc = await SizeChart.findOne({ slug: scSlug });
      if (!sc && !DRY) sc = await SizeChart.create({ nombre, slug: scSlug, unidad: 'cm', columns: cols.map(cap), rows });
      sizeChartId = sc ? sc._id : null;
    }

    // Aplicaciones (si el legado tuviera texto)
    const applications = [];
    for (const a of old.aplicaciones || []) { const app = await findOrCreateApplication(a); if (app) applications.push(app._id); }

    const descripcion = [old.descripcion, old.infoAdicional].filter(Boolean).join(' — ');

    console.log(`  colores=${colores.join('/') || '—'} · tallas=${tallas.join('/') || '—'} · variantes=${variants.length} · media=${media.length} · sizeChart=${sizeChartId ? 'sí' : 'no'} · apps=${applications.length}`);
    console.log(`  descripcion => "${descripcion}"`);

    if (DRY) continue;

    await col.updateOne(
      { _id: old._id },
      {
        $set: { options, variants, media, applications, features: [], attributes: [], descripcion, sizeChart: sizeChartId },
        $unset: { tela: '', atributos: '', sizeGuide: '', aplicaciones: '', infoAdicional: '', detalles: '' }
      }
    );
    console.log('  ✔ migrado');
    migrados += 1;
  }

  await mongoose.disconnect();
  console.log(`\n${DRY ? 'DRY-RUN completo.' : `Migración completa: ${migrados} producto(s).`}`);
}

run().catch((e) => { console.error('Error en migración:', e); process.exit(1); });
