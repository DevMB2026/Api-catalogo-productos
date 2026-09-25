// Cambia un color de UN producto por otro valor de color que ya existe (ej.
// "Gris" -> "Gris Perla") sin tocar los demás productos que comparten el
// valor: reemplaza el valor en options, en sus variantes (conservan _id, SKUs,
// stock) y en las fotos ligadas a él. Guarda un respaldo completo antes.
//
//   node scripts/cambiar-color.js "<slug>" --de "Gris" --a "Gris Perla"          (simulación)
//   node scripts/cambiar-color.js "<slug>" --de "Gris" --a "Gris Perla" --write  (respaldo + escribe)
//   node scripts/cambiar-color.js --rollback data/backups/<archivo>.json         (restaura)
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const { dispararWebhookSiAplica } = require('../src/services/notification.service');
const OptionValue = require('../src/models/optionValue.model');
require('../src/models/option.model');
const { validateProductDynamic } = require('../src/services/productValidation.service');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const val = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
const CAMPOS = ['options', 'variants', 'media', 'valoresOcultos'];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (val('--rollback')) {
    const b = JSON.parse(fs.readFileSync(val('--rollback'), 'utf8'));
    const set = {}; for (const k of CAMPOS) set[k] = b[k];
    const r = await Product.updateOne({ _id: b._id }, { $set: set });
    await dispararWebhookSiAplica({ _id: b._id, updatedAt: new Date() }, 'actualizado');
    console.log(`Restaurado ${b.nombre} (modificados: ${r.modifiedCount})`);
    return mongoose.disconnect();
  }
  const opciones = new Set([val('--de'), val('--a'), val('--rollback')]);
  const slug = args.find((a) => !a.startsWith('--') && !opciones.has(a));
  if (!slug || !val('--de') || !val('--a')) throw new Error('Uso: node scripts/cambiar-color.js "<slug>" --de "Color" --a "Otro color" [--write]');

  const p = await Product.findOne({ slug }).populate('options.option').populate('options.values');
  if (!p) throw new Error(`No existe el producto ${slug}`);
  const col = p.options.find((o) => o.option && (o.option.slug === 'color' || o.option.tipo === 'swatch'));
  const igual = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const de = col.values.find((v) => igual(v.valor, val('--de')));
  if (!de) throw new Error(`El producto no tiene el color "${val('--de')}"`);
  if (col.values.some((v) => igual(v.valor, val('--a')))) throw new Error(`El producto ya tiene "${val('--a')}"`);
  const a = await OptionValue.findOne({ option: col.option._id, valor: new RegExp(`^${val('--a').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (!a) throw new Error(`No existe el valor de color "${val('--a')}"; créalo primero en Opciones`);

  const cambia = (id) => (String(id) === String(de._id) ? a._id : id);
  const optionsNuevas = p.options.map((o) => ({ option: o.option._id, values: o.values.map((v) => cambia(v._id)) }));
  const variantsNuevas = p.variants.map((v) => { const x = v.toObject(); x.optionValues = x.optionValues.map(cambia); return x; });
  const mediaNueva = p.media.map((m) => { const x = m.toObject(); if (x.optionValue) x.optionValue = cambia(x.optionValue); return x; });
  const ocultosNuevos = (p.valoresOcultos || []).map(cambia);
  const nVar = p.variants.filter((v) => v.optionValues.some((ov) => String(ov) === String(de._id))).length;
  const nFot = p.media.filter((m) => String(m.optionValue) === String(de._id)).length;

  console.log(`Producto: ${p.nombre} — ${p._id}`);
  console.log(`Color: "${de.valor}" (${de._id}) -> "${a.valor}" (${a._id}, hex ${a.meta?.hex || '-'})`);
  console.log(`Se mueven: ${nVar} variantes (con sus SKUs) y ${nFot} fotos. Los demás productos con "${de.valor}" no cambian.`);

  const final = { ...p.toObject(), options: optionsNuevas, variants: variantsNuevas, media: mediaNueva, valoresOcultos: ocultosNuevos };
  await validateProductDynamic(final, { partial: false });
  console.log('Validación de la API: OK');
  if (!WRITE) { console.log('\nSimulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `cambiar-color-antes-${p.slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify(await Product.findById(p._id).lean(), null, 2));
  console.log(`Respaldo completo: ${archivo}`);
  const r = await Product.updateOne({ _id: p._id }, { $set: { options: optionsNuevas, variants: variantsNuevas, media: mediaNueva, valoresOcultos: ocultosNuevos } });
  await dispararWebhookSiAplica({ _id: p._id, updatedAt: new Date() }, 'actualizado'); // avisar a distribuidores con webhook
  console.log(`Escrito (modificados: ${r.modifiedCount}). Para restaurar: node scripts/cambiar-color.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
