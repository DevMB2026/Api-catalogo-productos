// Crea (o actualiza, si ya existe con ese nombre) una tabla de medidas y la
// asigna a un producto. Los datos vienen de un JSON:
//
//   {
//     "nombre": "Sudadera Cat — medidas",
//     "unidad": "cm",
//     "columns": ["Ancho pecho", "Ancho ruedo", "Largo talle", "Largo manga"],
//     "rows": [{ "label": "XCH", "values": [53, 52, 66, 60] }, ...],
//     "producto": "sudadera-cat",          // slug del producto
//     "asignarComo": "general"              // general | hombre | mujer
//   }
//
//   node scripts/subir-tabla-medidas.js data/tablas/sudadera-cat.json           (simulación)
//   node scripts/subir-tabla-medidas.js data/tablas/sudadera-cat.json --write   (respaldo + escribe)
//   node scripts/subir-tabla-medidas.js --rollback data/backups/<archivo>.json
//
// Asignar con updateOne (timestamps) cambia updatedAt, así los plugins de
// WordPress reciben la tabla en su próxima sincronización.
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const SizeChart = require('../src/models/sizeChart.model');
const { dispararWebhookSiAplica } = require('../src/services/notification.service');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const iRb = args.indexOf('--rollback');
const [archivoTabla] = args.filter((a) => !a.startsWith('--') && (iRb === -1 || a !== args[iRb + 1]));
const CAMPO = { general: 'sizeChart', hombre: 'sizeChartHombre', mujer: 'sizeChartMujer' };

async function rollback(archivo) {
  const b = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  await Product.updateOne({ _id: b.producto._id }, { $set: { [b.campo]: b.producto.antes || null } });
  if (b.tablaAntes) await SizeChart.replaceOne({ _id: b.tablaAntes._id }, b.tablaAntes);
  else if (b.tablaCreada) await SizeChart.deleteOne({ _id: b.tablaCreada });
  await dispararWebhookSiAplica({ _id: b.producto._id, updatedAt: new Date() }, 'actualizado');
  console.log(`Restaurado ${b.producto.nombre} (${b.campo}) desde ${archivo}`);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  if (iRb !== -1) { await rollback(args[iRb + 1]); return mongoose.disconnect(); }
  if (!archivoTabla) throw new Error('Uso: node scripts/subir-tabla-medidas.js <tabla.json> [--write]');

  const t = JSON.parse(fs.readFileSync(archivoTabla, 'utf8'));
  const campo = CAMPO[t.asignarComo || 'general'];
  if (!campo) throw new Error('asignarComo debe ser general, hombre o mujer');
  for (const r of t.rows) {
    if (r.values.length !== t.columns.length) throw new Error(`La fila ${r.label} tiene ${r.values.length} valores y hay ${t.columns.length} columnas`);
    if (r.values.some((v) => typeof v !== 'number' || Number.isNaN(v))) throw new Error(`La fila ${r.label} tiene valores que no son números`);
  }

  const producto = await Product.findOne({ slug: t.producto }).select('nombre slug sizeChart sizeChartHombre sizeChartMujer');
  if (!producto) throw new Error(`No existe el producto con slug "${t.producto}"`);
  const existente = await SizeChart.findOne({ nombre: t.nombre });

  console.log(`Tabla: ${t.nombre} (${existente ? 'se ACTUALIZA la existente' : 'NUEVA'}) — ${t.unidad || 'cm'}`);
  console.log(`  ${['Talla', ...t.columns].join(' | ')}`);
  for (const r of t.rows) console.log(`  ${[r.label, ...r.values].join(' | ')}`);
  console.log(`Producto: ${producto.nombre} → ${campo} (antes: ${producto[campo] || 'ninguna'})`);
  if (!WRITE) { console.log('\nSimulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const respaldo = path.join(dir, `tabla-medidas-antes-${producto.slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const datos = { nombre: t.nombre, unidad: t.unidad || 'cm', columns: t.columns, rows: t.rows, activo: true };
  let tabla;
  if (existente) {
    fs.writeFileSync(respaldo, JSON.stringify({ campo, producto: { _id: producto._id, nombre: producto.nombre, antes: producto[campo] }, tablaAntes: existente.toObject() }, null, 2));
    tabla = await SizeChart.findByIdAndUpdate(existente._id, datos, { new: true, runValidators: true });
  } else {
    tabla = await SizeChart.create(datos);
    fs.writeFileSync(respaldo, JSON.stringify({ campo, producto: { _id: producto._id, nombre: producto.nombre, antes: producto[campo] }, tablaCreada: tabla._id }, null, 2));
  }
  await Product.updateOne({ _id: producto._id }, { $set: { [campo]: tabla._id } });
  await dispararWebhookSiAplica({ _id: producto._id, updatedAt: new Date() }, 'actualizado');
  console.log(`\nRespaldo: ${respaldo}`);
  console.log(`Escrito: tabla ${tabla._id} asignada a ${producto.nombre}. Para revertir: node scripts/subir-tabla-medidas.js --rollback "${respaldo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
