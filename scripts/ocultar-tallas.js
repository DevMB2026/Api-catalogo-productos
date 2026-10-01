// Oculta (o vuelve a mostrar) tallas en TODOS los productos que las tengan,
// usando Product.valoresOcultos — igual que ocultar-valores.js, pero masivo.
// No borra variantes, SKUs, precios ni fotos: la API simplemente deja de
// mandarlas a WordPress, distribuidores y clientes.
//
//   node scripts/ocultar-tallas.js "4XG,5XG"                     (simulación, no escribe)
//   node scripts/ocultar-tallas.js "4XG,5XG" --write             (respaldo + escribe)
//   node scripts/ocultar-tallas.js "4XG,5XG" --mostrar --write   (vuelve a mostrarlas)
//   node scripts/ocultar-tallas.js --rollback data/backups/<archivo>.json
//
// Solo toca ejes que NO son de color (Talla, Cintura…). Si en un producto
// quedarían ocultas TODAS sus tallas, ese producto se omite y se avisa.
// Escribe con updateOne (timestamps) para que updatedAt cambie y los plugins
// lo reciban en su próxima sincronización (/products/changes).
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const { dispararWebhookSiAplica } = require('../src/services/notification.service');
require('../src/models/option.model');
require('../src/models/optionValue.model');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const MOSTRAR = args.includes('--mostrar');
const iRb = args.indexOf('--rollback');
const [tallasTxt] = args.filter((a) => !a.startsWith('--') && (iRb === -1 || a !== args[iRb + 1]));
const norm = (t) => String(t || '').trim().toUpperCase();
const esColor = (opt) => opt && (opt.tipo === 'swatch' || /color/i.test(opt.slug || '') || /color/i.test(opt.nombre || ''));

async function rollback(archivo) {
  const b = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  for (const p of b.productos) {
    await Product.updateOne({ _id: p._id }, { $set: { valoresOcultos: p.valoresOcultos } }); // eslint-disable-line no-await-in-loop
    await dispararWebhookSiAplica({ _id: p._id, updatedAt: new Date() }, 'actualizado'); // eslint-disable-line no-await-in-loop
  }
  console.log(`Restaurados ${b.productos.length} productos desde ${archivo}`);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (iRb !== -1) { await rollback(args[iRb + 1]); return mongoose.disconnect(); }
  if (!tallasTxt) throw new Error('Uso: node scripts/ocultar-tallas.js "4XG,5XG" [--mostrar] [--write]');
  const pedidas = tallasTxt.split(',').map(norm).filter(Boolean);

  const productos = await Product.find({}).populate('options.option').populate('options.values').select('nombre slug activo options variants valoresOcultos');
  const cambios = [];
  const omitidos = [];
  for (const p of productos) {
    const ejes = p.options.filter((o) => !esColor(o.option));
    const valores = ejes.flatMap((o) => o.values).filter((v) => v && pedidas.includes(norm(v.valor)));
    if (!valores.length) continue;

    const antes = (p.valoresOcultos || []).map(String);
    const ids = valores.map((v) => String(v._id));
    const despues = MOSTRAR ? antes.filter((x) => !ids.includes(x)) : [...new Set([...antes, ...ids])];
    if (despues.length === antes.length && despues.every((x) => antes.includes(x))) continue; // ya estaba así

    // No dejar un eje de tallas sin ninguna talla visible.
    const ocultos = new Set(despues);
    if (ejes.some((o) => o.values.length && o.values.every((v) => ocultos.has(String(v._id))))) { omitidos.push(p); continue; }

    const variantes = p.variants.filter((v) => (v.optionValues || []).some((x) => ids.includes(String(x)))).length;
    cambios.push({ p, antes, despues, tallas: valores.map((v) => v.valor), variantes });
  }

  console.log(`${MOSTRAR ? 'Mostrar' : 'Ocultar'} tallas: ${pedidas.join(', ')}\n`);
  for (const c of cambios) {
    console.log(`  ${c.p.activo ? '' : '(inactivo) '}${c.p.nombre}: ${c.tallas.join(', ')} — ${c.variantes} variantes`);
  }
  for (const p of omitidos) console.log(`  OMITIDO ${p.nombre}: quedaría sin ninguna talla visible`);
  console.log(`\n${cambios.length} productos cambian (${cambios.reduce((n, c) => n + c.variantes, 0)} variantes)${omitidos.length ? `, ${omitidos.length} omitidos` : ''}.`);
  if (!WRITE) { console.log('Simulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }
  if (!cambios.length) return mongoose.disconnect();

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `tallas-ocultas-antes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ productos: cambios.map((c) => ({ _id: c.p._id, nombre: c.p.nombre, valoresOcultos: c.antes })) }, null, 2));
  console.log(`Respaldo: ${archivo}`);

  let n = 0;
  for (const c of cambios) {
    const r = await Product.updateOne({ _id: c.p._id }, { $set: { valoresOcultos: c.despues } }); // eslint-disable-line no-await-in-loop
    n += r.modifiedCount;
    await dispararWebhookSiAplica({ _id: c.p._id, updatedAt: new Date() }, 'actualizado'); // eslint-disable-line no-await-in-loop
  }
  console.log(`Escrito (modificados: ${n}). Para revertir: node scripts/ocultar-tallas.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
