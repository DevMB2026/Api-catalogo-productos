// Deja EXACTAMENTE las aplicaciones (personalización) indicadas en todos los
// productos de una o varias categorías — activos e inactivos. Reemplaza la
// lista completa: ej. "Bordado" quita DTF, Vinil, etc. y deja solo Bordado.
//
//   node scripts/fijar-aplicaciones.js "chamarras,chalecos" "Bordado"          (simulación, no escribe)
//   node scripts/fijar-aplicaciones.js "chamarras,chalecos" "Bordado" --write  (respaldo + escribe)
//   node scripts/fijar-aplicaciones.js --rollback data/backups/<archivo>.json  (restaura el respaldo)
//
// Las categorías van por slug e incluyen sus subcategorías. Escribe con
// updateMany (timestamps) para que updatedAt cambie y los plugins de WordPress
// lo reciban en su próxima sincronización (/products/changes).
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const Category = require('../src/models/category.model');
const Application = require('../src/models/application.model');
const { dispararWebhookSiAplica } = require('../src/services/notification.service');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const iRb = args.indexOf('--rollback');
const [categoriasTxt, aplicacionesTxt] = args.filter((a) => !a.startsWith('--') && (iRb === -1 || a !== args[iRb + 1]));
const lista = (txt) => txt.split(',').map((t) => t.trim()).filter(Boolean);

async function conSubcategorias(ids) {
  const todas = await Category.find({}, '_id parent');
  const out = new Set(ids.map(String));
  let creció = true;
  while (creció) {
    creció = false;
    for (const c of todas) {
      if (c.parent && out.has(String(c.parent)) && !out.has(String(c._id))) { out.add(String(c._id)); creció = true; }
    }
  }
  return [...out];
}

async function rollback(archivo) {
  const b = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  for (const p of b.productos) {
    await Product.updateOne({ _id: p._id }, { $set: { applications: p.applications } }); // eslint-disable-line no-await-in-loop
    await dispararWebhookSiAplica({ _id: p._id, updatedAt: new Date() }, 'actualizado'); // eslint-disable-line no-await-in-loop
  }
  console.log(`Restaurados ${b.productos.length} productos desde ${archivo}`);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (iRb !== -1) { await rollback(args[iRb + 1]); return mongoose.disconnect(); }
  if (!categoriasTxt || !aplicacionesTxt) throw new Error('Uso: node scripts/fijar-aplicaciones.js "cat1,cat2" "Aplicacion1,Aplicacion2" [--write]');

  const slugs = lista(categoriasTxt).map((s) => s.toLowerCase());
  const cats = await Category.find({ slug: { $in: slugs } });
  const faltanCats = slugs.filter((s) => !cats.some((c) => c.slug === s));
  if (faltanCats.length) throw new Error(`Categorías que no existen: ${faltanCats.join(', ')}`);

  const pedidas = lista(aplicacionesTxt).map((t) => t.toLowerCase());
  const apps = await Application.find({ $or: [{ slug: { $in: pedidas } }, { nombre: { $in: lista(aplicacionesTxt) } }] });
  const faltanApps = pedidas.filter((t) => !apps.some((a) => a.slug === t || a.nombre.toLowerCase() === t));
  if (faltanApps.length) throw new Error(`Aplicaciones que no existen: ${faltanApps.join(', ')}`);
  const nuevas = apps.map((a) => a._id);

  const todasApps = new Map((await Application.find({})).map((a) => [String(a._id), a.nombre]));
  const nombres = (ids) => (ids || []).map((id) => todasApps.get(String(id)) || String(id)).join(', ') || '—';

  const productos = await Product.find({ category: { $in: await conSubcategorias(cats.map((c) => c._id)) } }).select('nombre slug activo applications');
  const mismas = (a) => a.length === nuevas.length && a.every((id) => nuevas.some((n) => String(n) === String(id)));
  const cambian = productos.filter((p) => !mismas(p.applications || []));

  console.log(`Categorías: ${cats.map((c) => c.nombre).join(', ')} — ${productos.length} productos`);
  console.log(`Dejar solo: ${apps.map((a) => a.nombre).join(', ')}\n`);
  for (const p of productos) {
    const marca = cambian.includes(p) ? 'CAMBIA ' : 'igual  ';
    console.log(`  ${marca} ${p.activo ? '' : '(inactivo) '}${p.nombre}: ${nombres(p.applications)}${cambian.includes(p) ? ` → ${nombres(nuevas)}` : ''}`);
  }
  console.log(`\n${cambian.length} productos cambian, ${productos.length - cambian.length} ya estaban así.`);
  if (!WRITE) { console.log('Simulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }
  if (!cambian.length) return mongoose.disconnect();

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `aplicaciones-antes-${slugs.join('-')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ productos: cambian.map((p) => ({ _id: p._id, nombre: p.nombre, applications: p.applications })) }, null, 2));
  console.log(`Respaldo: ${archivo}`);

  const r = await Product.updateMany({ _id: { $in: cambian.map((p) => p._id) } }, { $set: { applications: nuevas } });
  for (const p of cambian) await dispararWebhookSiAplica({ _id: p._id, updatedAt: new Date() }, 'actualizado'); // eslint-disable-line no-await-in-loop
  console.log(`Escrito (modificados: ${r.modifiedCount}). Para revertir: node scripts/fijar-aplicaciones.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
