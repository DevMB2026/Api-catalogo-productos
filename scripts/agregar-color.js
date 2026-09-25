// Agrega un color a UN producto con una variante por cada talla que ya tiene
// el producto, sus SKUs del ERP (hombre/mujer = prefijo + código de talla) y,
// opcionalmente, mueve a ese color fotos que hoy están en otro color.
// Copia composición y stock de una variante existente de la misma talla.
// Guarda un respaldo completo antes de escribir.
//
//   node scripts/agregar-color.js "<slug>" --color "Gris" --hombre POLFFITM63CCPOLGRO --mujer POLFFITM63DCPOLGRO \
//        [--despues "Gris Perla"] [--mover-fotos "gris-1-1,gris-2-1"] [--write]
//   node scripts/agregar-color.js --rollback data/backups/<archivo>.json
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
const TALLA_ERP = { XCH: 'XC', CH: 'CH', M: 'MD', G: 'GD', XG: 'XG', '2XG': 'XX', '3XG': '3X', '4XG': '4X', '5XG': '5X' };

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
  const conValor = new Set(['--color', '--hombre', '--mujer', '--despues', '--mover-fotos'].map(val));
  const slug = args.find((a) => !a.startsWith('--') && !conValor.has(a));
  const nombre = val('--color');
  if (!slug || !nombre || !val('--hombre') || !val('--mujer')) throw new Error('Faltan parámetros (ver encabezado del script)');

  const p = await Product.findOne({ slug }).populate('options.option').populate('options.values');
  if (!p) throw new Error(`No existe el producto ${slug}`);
  const col = p.options.find((o) => o.option && (o.option.slug === 'color' || o.option.tipo === 'swatch'));
  const tal = p.options.find((o) => o !== col);
  const igual = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  if (col.values.some((v) => igual(v.valor, nombre))) throw new Error(`El producto ya tiene el color "${nombre}"`);
  const valor = await OptionValue.findOne({ option: col.option._id, valor: new RegExp(`^${nombre}$`, 'i') });
  if (!valor) throw new Error(`No existe el valor de color "${nombre}"`);

  // Variantes nuevas: una por talla, SKU interno con el mismo patrón que las demás.
  const muestra = p.variants[0];
  const base = String(muestra.sku).split('-').slice(0, -2).join('-'); // ej. TPLBFMCD-TPLBFMCC
  const nuevas = tal.values.map((t) => {
    const cod = TALLA_ERP[t.valor];
    if (!cod) throw new Error(`Talla sin código de ERP: ${t.valor}`);
    const ref = p.variants.find((v) => v.optionValues.some((ov) => String(ov) === String(t._id)));
    return {
      sku: `${base}-${nombre.toUpperCase().replace(/\s+/g, '-')}-${t.valor}`,
      skusErp: [{ sku: val('--hombre') + cod, sexo: 'hombre' }, { sku: val('--mujer') + cod, sexo: 'mujer' }],
      optionValues: [valor._id, t._id],
      composicion: ref?.composicion,
      stock: ref?.stock || 0,
      media: [],
      activo: true
    };
  });

  // Posición del color en la lista.
  const ids = col.values.map((v) => v._id);
  const iDespues = val('--despues') ? col.values.findIndex((v) => igual(v.valor, val('--despues'))) : -1;
  ids.splice(iDespues === -1 ? ids.length : iDespues + 1, 0, valor._id);
  const optionsNuevas = p.options.map((o) => ({ option: o.option._id, values: o === col ? ids : o.values.map((v) => v._id) }));

  // Fotos a mover al color nuevo (por nombre de archivo en la URL).
  const mover = (val('--mover-fotos') || '').split(',').map((t) => t.trim()).filter(Boolean);
  let movidas = 0;
  const mediaNueva = p.media.map((m) => {
    const x = m.toObject();
    if (mover.some((n) => x.url.includes(`/${n}.`))) { x.optionValue = valor._id; movidas++; }
    return x;
  });
  if (movidas !== mover.length) throw new Error(`Se pidieron ${mover.length} fotos y se encontraron ${movidas}`);
  const variantsNuevas = [...p.variants.map((v) => v.toObject()), ...nuevas];

  console.log(`Producto: ${p.nombre} — ${p._id}`);
  console.log(`Color nuevo: "${valor.valor}" (${valor._id}, hex ${valor.meta?.hex || '-'}) — ${nuevas.length} variantes, ${nuevas.length * 2} SKUs`);
  nuevas.forEach((v) => console.log(`  ${v.sku.padEnd(34)} ${v.skusErp.map((e) => `${e.sku} (${e.sexo})`).join('  ')}`));
  console.log(`Colores: ${col.values.length} -> ${ids.length} | variantes: ${p.variants.length} -> ${variantsNuevas.length} | fotos movidas al color: ${movidas}`);

  const final = { ...p.toObject(), options: optionsNuevas, variants: variantsNuevas, media: mediaNueva };
  await validateProductDynamic(final, { partial: false }); // incluye: SKUs del ERP no usados en otro producto
  console.log('Validación de la API: OK');
  if (!WRITE) { console.log('\nSimulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `agregar-color-antes-${p.slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify(await Product.findById(p._id).lean(), null, 2));
  console.log(`Respaldo completo: ${archivo}`);
  const r = await Product.updateOne({ _id: p._id }, { $set: { options: optionsNuevas, variants: variantsNuevas, media: mediaNueva } });
  await dispararWebhookSiAplica({ _id: p._id, updatedAt: new Date() }, 'actualizado'); // avisar a distribuidores con webhook
  console.log(`Escrito (modificados: ${r.modifiedCount}). Para restaurar: node scripts/agregar-color.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message, e.details ? JSON.stringify(e.details) : ''); await mongoose.disconnect(); process.exit(1); });
