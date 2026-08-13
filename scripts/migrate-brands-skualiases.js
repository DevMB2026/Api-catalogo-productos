/**
 * Migración a la arquitectura multi-marca (SSOT):
 *   1) Todos los productos: brands = [brand]  (siembra el array desde la marca principal).
 *   2) Productos que también viven en fitbefresh.com: agrega su SKU propio a
 *      skuAliases (con brand=FitBeFresh) SOLO si difiere del SKU principal.
 * NO crea productos nuevos ni duplicados.
 *
 *   node scripts/migrate-brands-skualiases.js           # DRY-RUN
 *   node scripts/migrate-brands-skualiases.js --write     # aplica
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Brand = require('../src/models/brand.model');
const Product = require('../src/models/product.model');

const WRITE = process.argv.includes('--write');
const LABELS = new Set(['DAMA', 'CABALLERO', 'CORTO', 'LARGO', 'SR', 'SRA', 'CAB']);
const cleanSku = (raw) => (String(raw).toUpperCase().match(/[A-Z0-9]+/g) || []).filter((t) => !LABELS.has(t)).join('-');

// SKUs propios de fitbefresh.com (nombre = título de la página; sku = crudo).
const FBF = [
  { slug: 'playera-cotton', name: 'PLAYERA COTTON', sku: 'TPLBFCRU-1' },
  { slug: 'playera-cuello-redondo-unisex', name: 'PLAYERA CUELLO REDONDO UNISEX', sku: 'TPLBFCRU' },
  { slug: 'playera-polo-manga-larga', name: 'PLAYERA POLO MANGA LARGA', sku: 'DAMA: TPLBFMLD / CABALLERO: TPLBMLC' },
  { slug: 'playera-tipo-polo', name: 'PLAYERA POLO MANGA CORTA', sku: 'DAMA: TPLBFMCD / CABALLERO: TPLBFMCC' },
  { slug: 'sudadera-basica-unisex', name: 'SUDADERA BASICA UNISEX', sku: 'TSUDACRU' },
  { slug: 'sudadera-cat', name: 'SUDADERA CAT', sku: 'TSUDACRU-1' },
  { slug: 'sudadera-con-cierre-unisex', name: 'SUDADERA CON CIERRE UNISEX', sku: 'TSUDACCU' },
  { slug: 'sudadera-fleece-unisex', name: 'SUDADERA FLEECE UNISEX', sku: 'TSUDAFLU' },
  { slug: 'sudadera-fresh-unisex', name: 'SUDADERA FRESH UNISEX', sku: 'TSUDAFRU' },
  { slug: 'sudadera-hoodie-unisex', name: 'SUDADERA HOODIE UNISEX', sku: 'TSUDAHOU' },
  { slug: 'camisa-blusa-pescadora', name: 'CAMISA / BLUSA PESCADORA', sku: 'DAMA: TBLUPESC / CABALLERO: TCAMPESC' },
  { slug: 'camisa-blusa-pescadora-copia', name: 'CAMISA PESCADORA MANGA CORTA', sku: 'DAMA: TBLUPESC / CABALLERO: TCAMPESC-1' },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`\n=== MULTI-MARCA + ALIAS — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===\n`);

  // --- 1) brands = [brand] donde esté vacío ---
  const sinBrands = await Product.find({ $or: [{ brands: { $exists: false } }, { brands: { $size: 0 } }] });
  console.log(`1) Sembrar brands=[brand]: ${sinBrands.length} productos`);
  if (WRITE) {
    for (const p of sinBrands) { p.brands = [p.brand]; await p.save(); }
  }

  // --- 2) Alias de SKU para el solapamiento con fitbefresh.com ---
  const fbfBrand = await Brand.findOne({ slug: 'fitbefresh' });
  console.log(`\n2) Alias de SKU (marca FitBeFresh = ${fbfBrand ? fbfBrand._id : 'NO EXISTE'}):`);
  const all = await Product.find();
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  const bySku = new Map(all.map((p) => [p.sku, p]));
  const byName = new Map(all.map((p) => [String(p.nombre).toUpperCase(), p]));

  let alias = 0, iguales = 0, noMatch = 0;
  for (const f of FBF) {
    const csku = cleanSku(f.sku);
    const prod = bySlug.get(f.slug) || bySku.get(csku) || byName.get(f.name.toUpperCase());
    if (!prod) { noMatch++; console.log(`   ✗ sin match en DB: ${f.slug} (${f.name})`); continue; }
    if (csku === prod.sku) { iguales++; continue; } // mismo SKU en ambos sitios -> nada que agregar
    const yaEsta = (prod.skuAliases || []).some((a) => a.sku === csku);
    if (yaEsta) { iguales++; continue; }
    console.log(`   + ${prod.nombre.padEnd(30)} sku=${prod.sku}  +alias ${csku}`);
    if (WRITE) {
      prod.skuAliases.push({ sku: csku, brand: fbfBrand ? fbfBrand._id : undefined });
      await prod.save();
    }
    alias++;
  }

  console.log('\n=== RESUMEN ===');
  console.log(`brands sembrados: ${sinBrands.length}`);
  console.log(`Alias agregados: ${alias} | ya iguales/existentes: ${iguales} | sin match: ${noMatch}`);
  if (!WRITE) console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar.');
  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
