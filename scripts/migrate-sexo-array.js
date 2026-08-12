/**
 * Normaliza `sexo` de String (dato viejo) a array [String] en los productos.
 * Es OPCIONAL: el código nuevo ya lee un string viejo como [string]. Sirve para
 * dejar todos los documentos consistentes. Ejecutar DESPUÉS de desplegar el
 * backend nuevo (no antes, para no confundir al código viejo aún en producción).
 *
 *   node scripts/migrate-sexo-array.js
 *
 * Idempotente: los que ya son array no se tocan.
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.collection('products');
  const docs = await col.find({ sexo: { $type: 'string' } }).toArray();
  console.log(`Productos con sexo string: ${docs.length}`);
  for (const d of docs) {
    await col.updateOne({ _id: d._id }, { $set: { sexo: [d.sexo] } });
    console.log(`  ✔ ${d.nombre}: "${d.sexo}" -> ["${d.sexo}"]`);
  }
  await mongoose.disconnect();
  console.log('Migración completa.');
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
