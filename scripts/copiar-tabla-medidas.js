// Copia las tablas de medidas de un producto a otro(s): asigna las MISMAS
// tablas (general, caballero y dama), no las duplica — si después se corrige
// la tabla, se corrige en todos los productos que la usan.
//
//   node scripts/copiar-tabla-medidas.js <slug-origen> <slug-destino[,slug-destino2]>          (simulación)
//   node scripts/copiar-tabla-medidas.js <slug-origen> <slug-destino[,slug-destino2]> --write  (respaldo + escribe)
//   node scripts/copiar-tabla-medidas.js --rollback data/backups/<archivo>.json
//
// Escribe con updateOne (timestamps) para que updatedAt cambie y los plugins
// de WordPress reciban las tablas en su próxima sincronización.
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const SizeChart = require('../src/models/sizeChart.model');
const { dispararWebhookSiAplica } = require('../src/services/notification.service');

const CAMPOS = ['sizeChart', 'sizeChartHombre', 'sizeChartMujer'];
const ETIQUETA = { sizeChart: 'general', sizeChartHombre: 'caballero', sizeChartMujer: 'dama' };
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const iRb = args.indexOf('--rollback');
const [origenSlug, destinosTxt] = args.filter((a) => !a.startsWith('--') && (iRb === -1 || a !== args[iRb + 1]));

async function rollback(archivo) {
  const b = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  for (const p of b.productos) {
    await Product.updateOne({ _id: p._id }, { $set: p.antes }); // eslint-disable-line no-await-in-loop
    await dispararWebhookSiAplica({ _id: p._id, updatedAt: new Date() }, 'actualizado'); // eslint-disable-line no-await-in-loop
  }
  console.log(`Restaurados ${b.productos.length} productos desde ${archivo}`);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (iRb !== -1) { await rollback(args[iRb + 1]); return mongoose.disconnect(); }
  if (!origenSlug || !destinosTxt) throw new Error('Uso: node scripts/copiar-tabla-medidas.js <slug-origen> <slug-destino[,…]> [--write]');

  const select = `nombre slug ${CAMPOS.join(' ')}`;
  const origen = await Product.findOne({ slug: origenSlug }).select(select);
  if (!origen) throw new Error(`No existe el producto origen "${origenSlug}"`);
  const tablas = Object.fromEntries(CAMPOS.map((c) => [c, origen[c] || null]));
  if (!CAMPOS.some((c) => tablas[c])) throw new Error(`${origen.nombre} no tiene tablas de medidas`);
  const nombres = new Map((await SizeChart.find({ _id: { $in: CAMPOS.map((c) => tablas[c]).filter(Boolean) } })).map((t) => [String(t._id), t.nombre]));
  const nombre = (id) => (id ? nombres.get(String(id)) || String(id) : '—');

  const slugs = destinosTxt.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const destinos = await Product.find({ slug: { $in: slugs } }).select(select);
  const faltan = slugs.filter((s) => !destinos.some((d) => d.slug === s));
  if (faltan.length) throw new Error(`No existen: ${faltan.join(', ')}`);

  console.log(`Origen: ${origen.nombre}`);
  for (const c of CAMPOS) console.log(`  ${ETIQUETA[c].padEnd(9)} ${nombre(tablas[c])}`);
  for (const d of destinos) {
    console.log(`Destino: ${d.nombre}`);
    for (const c of CAMPOS) console.log(`  ${ETIQUETA[c].padEnd(9)} ${d[c] ? 'tenía una tabla' : '—'} → ${nombre(tablas[c])}`);
  }
  if (!WRITE) { console.log('\nSimulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `tablas-copiadas-antes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ productos: destinos.map((d) => ({ _id: d._id, nombre: d.nombre, antes: Object.fromEntries(CAMPOS.map((c) => [c, d[c] || null])) })) }, null, 2));
  for (const d of destinos) {
    await Product.updateOne({ _id: d._id }, { $set: tablas }); // eslint-disable-line no-await-in-loop
    await dispararWebhookSiAplica({ _id: d._id, updatedAt: new Date() }, 'actualizado'); // eslint-disable-line no-await-in-loop
  }
  console.log(`\nRespaldo: ${archivo}`);
  console.log(`Escrito en ${destinos.length} producto(s). Para revertir: node scripts/copiar-tabla-medidas.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
