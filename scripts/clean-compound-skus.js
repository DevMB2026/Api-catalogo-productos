/**
 * Normaliza los SKUs compuestos tipo "DAMA: TBLUAMAL / CABALLERO: TCAMAMAL"
 * (con espacios/":"/"/") a un SKU limpio uniendo los códigos con "-" y
 * descartando las etiquetas: -> "TBLUAMAL-TCAMAMAL".
 * También actualiza el prefijo en cada variant.sku.
 *
 *   node scripts/clean-compound-skus.js            # DRY-RUN (no escribe)
 *   node scripts/clean-compound-skus.js --write     # aplica los cambios
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');

const WRITE = process.argv.includes('--write');
const LABELS = new Set(['DAMA', 'CABALLERO', 'CORTO', 'LARGO', 'SR', 'SRA', 'CAB', 'NINO', 'NINA']);

function cleanSku(raw) {
  const tokens = (String(raw).toUpperCase().match(/[A-Z0-9]+/g) || []).filter((t) => !LABELS.has(t));
  return tokens.join('-');
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`\n=== SANEO DE SKUs COMPUESTOS — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===\n`);

  const prods = await Product.find({ sku: /[^A-Za-z0-9-]/ });
  console.log(`Productos con SKU compuesto: ${prods.length}\n`);

  const nuevos = new Map(); // newSku -> nombre (para detectar colisiones)
  let colisiones = 0;
  for (const p of prods) {
    const oldSku = p.sku;
    const newSku = cleanSku(oldSku);
    if (nuevos.has(newSku)) { colisiones++; console.log(`  ⚠ COLISIÓN: "${newSku}" ya usado por ${nuevos.get(newSku)}`); }
    nuevos.set(newSku, p.nombre);

    // El prefijo del variant.sku puede venir en distinto caso que product.sku
    // (el modelo fuerza uppercase en product.sku, no en variant.sku).
    const matchPrefix = (s) => s && s.toUpperCase().startsWith(oldSku.toUpperCase());
    const ejemploVar = p.variants[0];
    const newVarEj = ejemploVar && matchPrefix(ejemploVar.sku)
      ? newSku + ejemploVar.sku.slice(oldSku.length)
      : '(no coincide prefijo)';
    console.log(`  ${p.nombre}`);
    console.log(`     sku:  ${oldSku}`);
    console.log(`       ->  ${newSku}`);
    console.log(`     var:  ${ejemploVar ? ejemploVar.sku : '(sin variantes)'}  ->  ${newVarEj}`);

    if (WRITE) {
      for (const v of p.variants) {
        if (matchPrefix(v.sku)) v.sku = newSku + v.sku.slice(oldSku.length);
      }
      p.sku = newSku;
      await p.save();
      console.log('     ✓ guardado');
    }
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`Productos ${WRITE ? 'actualizados' : 'a actualizar'}: ${prods.length}`);
  console.log(`Colisiones de SKU nuevo: ${colisiones}`);
  if (!WRITE) console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar.');
  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
