/**
 * Respaldo local de TODA la base de datos (solo lectura): un archivo JSON por
 * colección en data/backups/respaldo-<fecha>/ (formato EJSON, conserva ObjectId
 * y fechas). data/ está en .gitignore: no se versiona (contiene datos de usuarios).
 *
 *   node scripts/respaldo-mongo.js
 */
const path = require('path');
const fs = require('fs');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { EJSON } = require('bson');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, '..', 'data', 'backups', `respaldo-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const colecciones = await db.listCollections().toArray();
  const resumen = {};
  for (const { name } of colecciones) {
    const docs = await db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(dir, `${name}.json`), EJSON.stringify(docs, { relaxed: false }, 2));
    resumen[name] = docs.length;
  }
  fs.writeFileSync(path.join(dir, '_resumen.json'),
    JSON.stringify({ base: mongoose.connection.name, fecha: new Date().toISOString(), documentos: resumen }, null, 2));

  console.log('Respaldo guardado en:', dir);
  console.table(resumen);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
