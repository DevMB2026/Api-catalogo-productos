/**
 * Etiqueta una marca en productos que YA existen (solapados), sin duplicar:
 *   - agrega la marca al array brands[] (si no está)
 *   - si el SKU del sitio difiere del principal, lo agrega a skuAliases (con marca)
 * Lee un TSV "slug<TAB>sku" (una línea por producto del sitio de esa marca).
 *
 *   node scripts/tag-brand-overlap.js --brand=<slug> --skus=<archivo.tsv>            # DRY-RUN
 *   node scripts/tag-brand-overlap.js --brand=<slug> --skus=<archivo.tsv> --write
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const Brand = require('../src/models/brand.model');
const Product = require('../src/models/product.model');

const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };
const WRITE = process.argv.includes('--write');
const BRAND = arg('brand');
const SKUS = arg('skus');
const LABELS = new Set(['DAMA', 'CABALLERO', 'CORTO', 'LARGO']);
const clean = (s) => (String(s || '').toUpperCase().match(/[A-Z0-9]+/g) || []).filter((t) => !LABELS.has(t)).join('-');

async function run() {
  if (!BRAND || !SKUS) { console.error('Uso: --brand=<slug> --skus=<archivo.tsv> [--write]'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI);
  const brand = await Brand.findOne({ slug: BRAND });
  if (!brand) { console.error(`Marca no existe: ${BRAND}`); process.exit(1); }
  console.log(`\n=== ETIQUETAR "${brand.nombre}" EN SOLAPADOS — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===\n`);

  const rows = fs.readFileSync(SKUS, 'utf-8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  let addBrand = 0, addAlias = 0, sinCambio = 0, noHallado = 0;
  for (const [slug, sku] of rows) {
    const p = await Product.findOne({ slug });
    if (!p) { noHallado++; console.log(`   ! no está en DB: ${slug}`); continue; }
    let changed = false;
    if (!(p.brands || []).some((b) => String(b) === String(brand._id))) {
      p.brands.push(brand._id); addBrand++; changed = true;
    }
    const c = clean(sku);
    if (c && c !== p.sku && !(p.skuAliases || []).some((a) => a.sku === c)) {
      p.skuAliases.push({ sku: c, brand: brand._id }); addAlias++; changed = true;
      console.log(`   + alias ${slug}: ${c}`);
    }
    if (changed) { if (WRITE) await p.save(); } else sinCambio++;
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Productos donde se agrega la marca: ${addBrand}`);
  console.log(`Alias de SKU agregados: ${addAlias}`);
  console.log(`Sin cambios (ya tenían marca y SKU): ${sinCambio} | no hallados: ${noHallado}`);
  if (!WRITE) console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar.');
  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
