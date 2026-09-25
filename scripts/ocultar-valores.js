// Oculta (o vuelve a mostrar) valores de opción de UN producto — ej. colores —
// usando Product.valoresOcultos. No borra variantes, SKUs ni fotos.
//
//   node scripts/ocultar-valores.js "<nombre o slug>" "Verde,Rojo"            (simulación, no escribe)
//   node scripts/ocultar-valores.js "<nombre o slug>" "Verde,Rojo" --write    (respaldo + escribe)
//   node scripts/ocultar-valores.js "<nombre o slug>" "Verde" --mostrar --write (quita de ocultos)
//   node scripts/ocultar-valores.js --rollback data/backups/<archivo>.json    (restaura el respaldo)
//
// Escribe con updateOne (timestamps) para que updatedAt cambie y el plugin de
// WordPress lo reciba en su próxima sincronización (/products/changes).
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
require('../src/models/option.model');
require('../src/models/optionValue.model');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const MOSTRAR = args.includes('--mostrar');
const iRb = args.indexOf('--rollback');
const [busqueda, valoresTxt] = args.filter((a) => !a.startsWith('--') && (iRb === -1 || a !== args[iRb + 1]));
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function rollback(archivo) {
  const b = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const r = await Product.updateOne({ _id: b._id }, { $set: { valoresOcultos: b.valoresOcultos } });
  console.log(`Restaurado ${b.nombre}: valoresOcultos = ${JSON.stringify(b.valoresOcultos)} (modificados: ${r.modifiedCount})`);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (iRb !== -1) { await rollback(args[iRb + 1]); return mongoose.disconnect(); }
  if (!busqueda || !valoresTxt) throw new Error('Uso: node scripts/ocultar-valores.js "<nombre o slug>" "Valor1,Valor2" [--mostrar] [--write]');

  const candidatos = await Product.find({ $or: [{ slug: busqueda.toLowerCase() }, { nombre: new RegExp(esc(busqueda), 'i') }] })
    .populate('options.option').populate('options.values');
  if (candidatos.length !== 1) {
    console.log(`Se encontraron ${candidatos.length} productos; afina la búsqueda:`);
    candidatos.forEach((p) => console.log(`  - ${p.nombre} | slug ${p.slug} | ${p._id}`));
    return mongoose.disconnect();
  }
  const p = candidatos[0];
  const pedidos = valoresTxt.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const valores = p.options.flatMap((o) => o.values).filter((v) => pedidos.includes(String(v.valor).trim().toLowerCase()));
  const faltan = pedidos.filter((t) => !valores.some((v) => String(v.valor).trim().toLowerCase() === t));
  if (faltan.length) throw new Error(`No existen en el producto: ${faltan.join(', ')}`);

  const nombreDe = new Map(p.options.flatMap((o) => o.values).map((v) => [String(v._id), v.valor]));
  const antes = (p.valoresOcultos || []).map(String);
  const ids = valores.map((v) => String(v._id));
  const despues = MOSTRAR ? antes.filter((x) => !ids.includes(x)) : [...new Set([...antes, ...ids])];
  const lista = (xs) => xs.map((x) => nombreDe.get(x) || x).join(', ') || '(ninguno)';

  console.log(`Producto: ${p.nombre} — ${p._id}`);
  console.log(`Ocultos antes:   ${lista(antes)}`);
  console.log(`Ocultos después: ${lista(despues)}`);
  if (!WRITE) { console.log('\nSimulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `valores-ocultos-antes-${p.slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ _id: p._id, nombre: p.nombre, valoresOcultos: antes }, null, 2));
  console.log(`Respaldo: ${archivo}`);

  const r = await Product.updateOne({ _id: p._id }, { $set: { valoresOcultos: despues } });
  console.log(`Escrito (modificados: ${r.modifiedCount}). Para revertir: node scripts/ocultar-valores.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
