// Borra DEFINITIVAMENTE colores de UN producto: los quita de options y borra
// sus variantes (con sus SKUs) y las fotos ligadas a ellos. Deja solo los
// colores indicados. Antes de escribir guarda un respaldo completo.
//
//   node scripts/borrar-colores.js "<slug>" --dejar "Negro,Azul Marino"          (simulación)
//   node scripts/borrar-colores.js "<slug>" --dejar "Negro,Azul Marino" --write  (respaldo + escribe)
//   node scripts/borrar-colores.js --rollback data/backups/<archivo>.json        (restaura)
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const { dispararWebhookSiAplica } = require('../src/services/notification.service');
require('../src/models/option.model');
require('../src/models/optionValue.model');
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
  const slug = args.find((a) => !a.startsWith('--') && a !== val('--dejar'));
  const dejar = (val('--dejar') || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!slug || !dejar.length) throw new Error('Uso: node scripts/borrar-colores.js "<slug>" --dejar "Color1,Color2" [--write]');

  const p = await Product.findOne({ slug }).populate('options.option').populate('options.values');
  if (!p) throw new Error(`No existe el producto ${slug}`);
  const col = p.options.find((o) => o.option && (o.option.slug === 'color' || o.option.tipo === 'swatch'));
  const quedan = col.values.filter((v) => dejar.includes(String(v.valor).trim().toLowerCase()));
  const faltan = dejar.filter((t) => !quedan.some((v) => String(v.valor).trim().toLowerCase() === t));
  if (faltan.length) throw new Error(`Esos colores no existen en el producto: ${faltan.join(', ')}`);
  const borrar = col.values.filter((v) => !quedan.includes(v));
  const idsBorrar = new Set(borrar.map((v) => String(v._id)));

  const variantsNuevas = p.variants.filter((v) => !v.optionValues.some((ov) => idsBorrar.has(String(ov))));
  const mediaNueva = p.media.filter((m) => !m.optionValue || !idsBorrar.has(String(m.optionValue)));
  const optionsNuevas = p.options.map((o) => ({
    option: o.option._id,
    values: (o === col ? quedan : o.values).map((v) => v._id)
  }));
  const ocultosNuevos = (p.valoresOcultos || []).filter((id) => !idsBorrar.has(String(id)));
  const skus = (vs) => vs.reduce((n, v) => n + (v.skusErp || []).length, 0);

  console.log(`Producto: ${p.nombre} — ${p._id}`);
  console.log(`Se quedan (${quedan.length}): ${quedan.map((v) => v.valor).join(', ')}`);
  console.log(`Se BORRAN (${borrar.length}): ${borrar.map((v) => v.valor).join(', ')}`);
  console.log(`Variantes: ${p.variants.length} -> ${variantsNuevas.length} | SKUs: ${skus(p.variants)} -> ${skus(variantsNuevas)} | fotos: ${p.media.length} -> ${mediaNueva.length} | ocultos: ${(p.valoresOcultos || []).length} -> ${ocultosNuevos.length}`);

  // Validación de la API sobre el estado final.
  const final = { ...p.toObject(), options: optionsNuevas, variants: variantsNuevas.map((v) => v.toObject()), media: mediaNueva, valoresOcultos: ocultosNuevos };
  await validateProductDynamic(final, { partial: false });
  console.log('Validación de la API: OK');
  if (!WRITE) { console.log('\nSimulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `borrar-colores-antes-${p.slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const crudo = await Product.findById(p._id).lean();
  fs.writeFileSync(archivo, JSON.stringify(crudo, null, 2));
  console.log(`Respaldo completo: ${archivo}`);

  const r = await Product.updateOne({ _id: p._id }, {
    $set: { options: optionsNuevas, variants: variantsNuevas, media: mediaNueva, valoresOcultos: ocultosNuevos }
  });
  await dispararWebhookSiAplica({ _id: p._id, updatedAt: new Date() }, 'actualizado'); // avisar a distribuidores con webhook
  console.log(`Escrito (modificados: ${r.modifiedCount}). Para restaurar: node scripts/borrar-colores.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
