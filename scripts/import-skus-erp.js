/**
 * Vincula los SKUs del ERP (PRODUCTOS 2026.xlsx) a variantes que YA existen en
 * el catálogo, guardándolos en variants[].skusErp = [{ sku, sexo }].
 * NO crea productos, variantes, tallas ni colores. El mapeo (producto, variante,
 * SKUs) viene ya revisado y aprobado en data/skus-erp-mapping.json.
 *
 *   node scripts/import-skus-erp.js                       # DRY-RUN (no escribe)
 *   node scripts/import-skus-erp.js --write               # respalda y aplica
 *   node scripts/import-skus-erp.js --rollback <archivo>  # restaura desde un respaldo
 *
 * Es idempotente: reescribe skusErp completo por variante, correrlo dos veces
 * deja el mismo resultado. Se detiene si encuentra algo inesperado.
 */
const path = require('path');
const fs = require('fs');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
fs.readdirSync(path.join(__dirname, '../src/models')).forEach((f) => require(path.join(__dirname, '../src/models', f)));
const Product = require('../src/models/product.model');

const WRITE = process.argv.includes('--write');
const rbIdx = process.argv.indexOf('--rollback');
const ROLLBACK = rbIdx > -1 ? process.argv[rbIdx + 1] : null;
const MAPPING = path.join(__dirname, '../data/skus-erp-mapping.json');
const BACKUP_DIR = path.join(__dirname, '../data/backups');

const stop = (msg) => { console.error('\n✗ ' + msg); process.exitCode = 1; };

async function rollback() {
  const b = JSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
  console.log(`\n=== ROLLBACK desde ${path.basename(ROLLBACK)} (${b.variantes.length} variantes) ===`);
  const ops = b.variantes.map((v) => ({
    updateOne: {
      filter: { _id: v.productId },
      update: { $set: { 'variants.$[v].skusErp': v.skusErpAntes } },
      arrayFilters: [{ 'v._id': new mongoose.Types.ObjectId(v.variantId) }]
    }
  }));
  const r = await Product.bulkWrite(ops);
  console.log(`Restauradas: ${r.modifiedCount} variantes`);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  if (ROLLBACK) { await rollback(); return; }

  const map = JSON.parse(fs.readFileSync(MAPPING, 'utf8'));
  console.log(`\n=== IMPORTAR SKUs ERP — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===`);
  console.log(`Mapeo: ${map.total_variantes} variantes, ${map.total_skus} SKUs (${map.fuente})\n`);

  const prodIds = [...new Set(map.variantes.map((v) => v.productId))];
  const prods = await Product.find({ _id: { $in: prodIds } }).select('nombre sku activo variants');
  const byId = new Map(prods.map((p) => [String(p._id), p]));

  // ---- Pre-vuelo: todo debe seguir siendo como cuando se armó el mapeo ----
  const problemas = [];
  const backup = [];
  const codigos = new Map(); // sku -> variantId (duplicados dentro del mapeo)
  for (const m of map.variantes) {
    const p = byId.get(m.productId);
    if (!p) { problemas.push(`Producto no existe: ${m.producto} (${m.productId})`); continue; }
    if (p.nombre !== m.producto) problemas.push(`Nombre cambió: "${m.producto}" -> "${p.nombre}"`);
    const v = p.variants.id(m.variantId);
    if (!v) { problemas.push(`Variante no existe: ${m.producto} / ${m.varianteSku}`); continue; }
    if (v.sku !== m.varianteSku) problemas.push(`SKU de variante cambió: ${m.varianteSku} -> ${v.sku}`);
    if ((v.skusErp || []).length) {
      const actual = v.skusErp.map((e) => `${e.sku}|${e.sexo}`).sort().join(',');
      const nuevo = m.skusErp.map((e) => `${e.sku.toUpperCase()}|${e.sexo}`).sort().join(',');
      if (actual !== nuevo) problemas.push(`La variante ya tiene otros skusErp: ${m.varianteSku} (${actual})`);
    }
    for (const e of m.skusErp) {
      const k = e.sku.toUpperCase();
      if (codigos.has(k) && codigos.get(k) !== m.variantId) problemas.push(`SKU repetido en el mapeo para 2 variantes: ${k}`);
      codigos.set(k, m.variantId);
    }
    backup.push({ productId: m.productId, variantId: m.variantId, varianteSku: v.sku, skusErpAntes: (v.skusErp || []).map((e) => ({ sku: e.sku, sexo: e.sexo })) });
  }
  // unicidad global: ningún otro lugar de la DB puede tener ya estos códigos
  const dupDb = await Product.find({ 'variants.skusErp.sku': { $in: [...codigos.keys()] } }).select('nombre variants._id variants.skusErp');
  for (const p of dupDb) {
    for (const v of p.variants) for (const e of v.skusErp || []) {
      if (codigos.has(e.sku) && codigos.get(e.sku) !== String(v._id)) problemas.push(`SKU ${e.sku} ya está en otra variante (${p.nombre})`);
    }
  }
  if (problemas.length) { problemas.slice(0, 30).forEach((x) => console.error('  ✗ ' + x)); return stop(`${problemas.length} problema(s) en el pre-vuelo. No se escribió nada.`); }
  console.log('Pre-vuelo OK: productos y variantes existen, sin cambios de nombre/SKU, sin SKUs repetidos.');

  // ---- Resumen por producto ----
  const resumen = new Map();
  for (const m of map.variantes) {
    const r = resumen.get(m.producto) || { variantes: 0, skus: 0 };
    r.variantes++; r.skus += m.skusErp.length; resumen.set(m.producto, r);
  }
  console.log(`\n${'Producto'.padEnd(38)} variantes  SKUs`);
  for (const [n, r] of [...resumen].sort()) console.log(`${n.padEnd(38)} ${String(r.variantes).padStart(9)} ${String(r.skus).padStart(5)}`);
  console.log(`${'TOTAL'.padEnd(38)} ${String(map.total_variantes).padStart(9)} ${String(map.total_skus).padStart(5)}`);

  if (!WRITE) { console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar (hace respaldo antes).'); return; }

  // ---- Respaldo + escritura ----
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bfile = path.join(BACKUP_DIR, `skus-erp-antes-${stamp}.json`);
  fs.writeFileSync(bfile, JSON.stringify({ fecha: new Date().toISOString(), variantes: backup }, null, 1));
  console.log(`\nRespaldo: ${path.relative(path.join(__dirname, '..'), bfile)}`);

  const ops = map.variantes.map((m) => ({
    updateOne: {
      filter: { _id: m.productId },
      update: { $set: { 'variants.$[v].skusErp': m.skusErp.map((e) => ({ sku: e.sku, sexo: e.sexo })) } },
      arrayFilters: [{ 'v._id': new mongoose.Types.ObjectId(m.variantId) }]
    }
  }));
  const r = await Product.bulkWrite(ops, { ordered: true });
  console.log(`Escritas: ${r.modifiedCount} variantes (matched ${r.matchedCount})`);

  // ---- Verificación posterior ----
  const after = await Product.find({ _id: { $in: prodIds } }).select('variants._id variants.skusErp');
  let variantes = 0, skus = 0, mal = 0;
  const afterVar = new Map();
  for (const p of after) for (const v of p.variants) afterVar.set(String(v._id), v.skusErp || []);
  for (const m of map.variantes) {
    const got = afterVar.get(m.variantId) || [];
    const a = got.map((e) => `${e.sku}|${e.sexo}`).sort().join(',');
    const b = m.skusErp.map((e) => `${e.sku.toUpperCase()}|${e.sexo}`).sort().join(',');
    if (a !== b) mal++;
    if (got.length) variantes++;
    skus += got.length;
  }
  console.log(`Verificación: ${variantes} variantes con SKU ERP, ${skus} SKUs guardados, ${mal} discrepancias.`);
  if (mal) stop('Hay discrepancias tras escribir; revisa o usa --rollback con el respaldo.');
  else console.log('✓ Importación verificada.');
}

run().catch((e) => { console.error('Error:', e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
