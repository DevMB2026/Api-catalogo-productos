/**
 * Normaliza las TALLAS a español y les asigna un `orden` canónico, para que
 * siempre salgan ordenadas (XCH, CH, M, G, XG, 2XG, 3XG) y no alfabéticas.
 *   L -> G, XL -> XG, 2XL -> 2XG, 3XL -> 3XG   (CH/XCH/M ya están en español)
 * Además reordena el array de tallas dentro de cada producto por ese `orden`.
 * La opción "Cintura" (numérica) se ordena por su número.
 *
 *   node scripts/normalize-sizes.js           # DRY-RUN
 *   node scripts/normalize-sizes.js --write     # aplica
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Option = require('../src/models/option.model');
const OptionValue = require('../src/models/optionValue.model');
const Product = require('../src/models/product.model');

const WRITE = process.argv.includes('--write');

// Mapa por slug actual -> { valor, slug?, orden, activo? }
const TALLA = {
  xs:   { valor: 'XS',  orden: 0, activo: false }, // sembrada, sin uso -> se oculta
  xxch: { valor: 'XXCH', orden: 0 }, // extra-extra chica (nueva de Be Fresh Security)
  xch:  { valor: 'XCH', orden: 1 },
  s:    { valor: 'S',   orden: 2, activo: false }, // inglés, oculta
  ch:   { valor: 'CH',  orden: 2 },
  m:    { valor: 'M',   orden: 3 },
  // claves por slug viejo (inglés) Y nuevo (español) para que el reordenar sea idempotente
  l:    { valor: 'G',   slug: 'g',   orden: 4 },
  g:    { valor: 'G',   orden: 4 },
  xl:   { valor: 'XG',  slug: 'xg',  orden: 5 },
  xg:   { valor: 'XG',  orden: 5 },
  xxl:  { valor: 'XXL', orden: 5, activo: false }, // sembrada, sin uso -> se oculta
  '2xl': { valor: '2XG', slug: '2xg', orden: 6 },
  '2xg': { valor: '2XG', orden: 6 },
  '3xl': { valor: '3XG', slug: '3xg', orden: 7 },
  '3xg': { valor: '3XG', orden: 7 },
};

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`\n=== NORMALIZAR TALLAS — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===\n`);

  const opts = await Option.find().lean();
  const tallaOpt = opts.find((o) => o.slug === 'talla');
  const cinturaOpt = opts.find((o) => o.slug === 'cintura');
  const sizeOptIds = opts.filter((o) => o.tipo === 'size').map((o) => String(o._id));

  // --- 1) Renombrar + orden de valores de Talla ---
  console.log('1) Valores de Talla:');
  const vals = await OptionValue.find({ option: tallaOpt._id });
  for (const v of vals) {
    const t = TALLA[v.slug];
    if (!t) { console.log(`   ? ${v.valor} (slug=${v.slug}) sin regla, se deja`); continue; }
    const nuevoSlug = t.slug || v.slug;
    const cambios = [];
    if (v.valor !== t.valor) cambios.push(`valor ${v.valor}->${t.valor}`);
    if (v.slug !== nuevoSlug) cambios.push(`slug ${v.slug}->${nuevoSlug}`);
    if (v.orden !== t.orden) cambios.push(`orden ${v.orden}->${t.orden}`);
    if (t.activo === false && v.activo !== false) cambios.push('desactivar (sin uso)');
    console.log(`   ${v.valor.padEnd(5)} -> ${t.valor.padEnd(5)} orden=${t.orden}${t.activo === false ? ' [oculta]' : ''}  ${cambios.length ? '(' + cambios.join(', ') + ')' : '(sin cambios)'}`);
    if (WRITE) {
      v.valor = t.valor; v.slug = nuevoSlug; v.orden = t.orden;
      if (t.activo === false) v.activo = false;
      await v.save();
    }
  }

  // --- 2) Orden de Cintura (numérico) ---
  if (cinturaOpt) {
    console.log('\n2) Valores de Cintura (por número):');
    const cv = await OptionValue.find({ option: cinturaOpt._id });
    for (const v of cv) {
      const orden = parseInt(v.valor, 10) || 0;
      console.log(`   ${v.valor} -> orden ${orden}`);
      if (WRITE) { v.orden = orden; await v.save(); }
    }
  }

  // --- 3) Reordenar el array de tallas dentro de cada producto ---
  console.log('\n3) Reordenar tallas por producto:');
  const ordenById = new Map();
  for (const v of await OptionValue.find({ option: { $in: sizeOptIds } }).lean()) {
    ordenById.set(String(v._id), v.orden || 0);
  }
  const prods = await Product.find({ 'options.option': { $in: sizeOptIds } });
  let reordenados = 0;
  for (const p of prods) {
    let changed = false;
    for (const o of p.options) {
      if (!sizeOptIds.includes(String(o.option))) continue;
      const antes = o.values.map(String).join(',');
      o.values.sort((a, b) => (ordenById.get(String(a)) || 0) - (ordenById.get(String(b)) || 0));
      if (o.values.map(String).join(',') !== antes) changed = true;
    }
    if (changed) { reordenados++; if (WRITE) await p.save(); }
  }
  console.log(`   Productos con tallas reordenadas: ${reordenados} de ${prods.length}`);

  console.log('\n=== RESUMEN ===');
  console.log(`Valores de Talla procesados: ${vals.length}`);
  console.log(`Productos reordenados: ${reordenados}`);
  if (!WRITE) console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar.');
  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
