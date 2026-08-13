/**
 * Importa Be Fresh Security a la arquitectura multi-marca (SSOT):
 *   A) Crea los 9 productos NUEVOS (marca principal = Be Fresh Security),
 *      reutilizando categorías/opciones/valores existentes (crea los que falten:
 *      talla XXCH, colores neón combinados).
 *   B) Los 3 SOLAPADOS (mismo SKU que un producto existente) NO se duplican:
 *      solo se agrega "Be Fresh Security" a su brands[] (SKUs idénticos -> sin alias).
 *
 *   node scripts/import-befreshsecurity.js            # DRY-RUN
 *   node scripts/import-befreshsecurity.js --write
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const slugify = require('slugify');
const Brand = require('../src/models/brand.model');
const Category = require('../src/models/category.model');
const Option = require('../src/models/option.model');
const OptionValue = require('../src/models/optionValue.model');
const Product = require('../src/models/product.model');

const WRITE = process.argv.includes('--write');
const slug = (s) => slugify(String(s), { lower: true, strict: true, trim: true });
const DATA = path.join(__dirname, '..', 'data', 'befreshsecurity-catalogo.json');

// Solapados: (cómo hallar el producto existente) -> agregar marca BFS.
const OVERLAPS = [
  { find: { sku: 'TBLUMEZC-TCAMMEZC' }, label: 'CAMISA MEZCLILLA (= MEZCLILLA CON REFLEJANTES)' },
  { find: { slug: 'playera-polo-manga-corta' }, label: 'PLAYERA POLO MANGA CORTA' },
  { find: { sku: '009003' }, label: 'PANTALÓN DE MEZCLILLA (= PANTALON ... CON REFLEJANTE)' },
];

const stats = { productos: 0, values: 0, brandAdds: 0, skipped: 0 };

function publicIdFromUrl(url) {
  const f = url.split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '');
  return `bfs-wp/${f}`;
}
const toMedia = (arr) => (arr || []).filter((m) => m.url).map((m, i) => ({
  url: m.url, public_id: publicIdFromUrl(m.url), alt: m.alt, orden: i, principal: !!m.principal || i === 0
}));

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`\n=== IMPORT BE FRESH SECURITY — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===\n`);

  const brand = await Brand.findOne({ slug: 'befreshsecurity' });
  if (!brand) { console.error('Falta la marca befreshsecurity'); process.exit(1); }
  const colorOpt = await Option.findOne({ slug: 'color' });
  const tallaOpt = await Option.findOne({ slug: 'talla' });

  const valId = {};
  async function ensureValue(optId, valor) {
    const s = slug(valor);
    const key = `${optId}:${s}`;
    if (valId[key]) return valId[key];
    let v = await OptionValue.findOne({ option: optId, slug: s });
    if (!v) {
      console.log(`   + [valor nuevo] ${valor}`);
      stats.values++;
      v = WRITE ? await OptionValue.create({ option: optId, valor, slug: s }) : { _id: new mongoose.Types.ObjectId() };
    }
    valId[key] = v._id;
    return v._id;
  }

  // --- A) Productos nuevos ---
  console.log('A) Productos nuevos:');
  const productos = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
  for (const p of productos) {
    if (await Product.findOne({ slug: p.slug })) { stats.skipped++; console.log(`   · ya existe: ${p.nombre}`); continue; }
    const cat = await Category.findOne({ slug: p.categoriaSlug });
    if (!cat) { console.log(`   ! categoría no existe: ${p.categoriaSlug} (${p.nombre}) — SALTO`); continue; }

    const nameToId = {};
    const options = [];
    for (const o of p.options) {
      const optId = o.nombre === 'Color' ? colorOpt._id : tallaOpt._id;
      const values = [];
      for (const v of o.valores) { const id = await ensureValue(optId, v.nombre); values.push(id); nameToId[v.nombre] = id; }
      options.push({ option: optId, values });
    }
    const variants = p.variants.map((v) => ({
      sku: v.sku, optionValues: v.optionValues.map((n) => nameToId[n]).filter(Boolean),
      stock: v.stock || 0, media: toMedia(v.media)
    }));

    const doc = {
      nombre: p.nombre, sku: p.sku, slug: p.slug, descripcion: p.descripcion || undefined,
      brand: brand._id, brands: [brand._id], category: cat._id, sexo: p.sexo,
      attributes: [], options, variants, media: toMedia(p.media), destacado: false, activo: true,
    };
    console.log(`   + ${p.nombre.padEnd(32)} ${cat.nombre.padEnd(12)} ${variants.length} variantes`);
    if (WRITE) await Product.create(doc);
    stats.productos++;
  }

  // --- B) Solapados: agregar marca BFS ---
  console.log('\nB) Solapados (agregar marca, sin duplicar):');
  for (const o of OVERLAPS) {
    const prod = await Product.findOne(o.find);
    if (!prod) { console.log(`   ! no hallado: ${o.label}`); continue; }
    const ya = (prod.brands || []).some((b) => String(b) === String(brand._id));
    if (ya) { console.log(`   · ya tiene la marca: ${prod.nombre}`); continue; }
    console.log(`   + ${prod.nombre.padEnd(34)} brands += Be Fresh Security`);
    if (WRITE) { prod.brands.push(brand._id); await prod.save(); }
    stats.brandAdds++;
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Productos nuevos: ${stats.productos} | omitidos: ${stats.skipped}`);
  console.log(`Valores de opción nuevos: ${stats.values}`);
  console.log(`Marcas agregadas a solapados: ${stats.brandAdds}`);
  if (!WRITE) console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar.');
  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
