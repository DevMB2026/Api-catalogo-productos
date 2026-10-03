// Convierte una cuenta EXISTENTE (ej. un usuario de precios creado desde el
// panel) en administrador. Conserva correo y contraseña; solo cambia el rol
// y la deja activa.
//
//   node scripts/promover-admin.js --buscar "marketing"         (lista cuentas por nombre o correo; no escribe)
//   node scripts/promover-admin.js <email>                       (simulación)
//   node scripts/promover-admin.js <email> --write               (respaldo + escribe)
//   node scripts/promover-admin.js <email> --desactivar --write  (le quita el acceso, sin borrar la cuenta)
//   node scripts/promover-admin.js --rollback data/backups/<archivo>.json
//
// requireAdmin relee la cuenta en Mongo en cada petición, pero el panel
// decide qué pantallas mostrar con el rol guardado al iniciar sesión: la
// persona debe cerrar sesión y volver a entrar.
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // igual que los demás scripts (SRV de Atlas)
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../src/models/user.model');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const DESACTIVAR = args.includes('--desactivar');
const iRb = args.indexOf('--rollback');
const iBus = args.indexOf('--buscar');
// El valor que sigue a --rollback / --buscar no es el correo.
const valoresDeOpcion = new Set([iRb, iBus].filter((i) => i !== -1).map((i) => i + 1));
const [email] = args.filter((a, i) => !a.startsWith('--') && !valoresDeOpcion.has(i));
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fila = (u) => `${u.email} | nombre: ${u.nombre || '—'} | rol: ${u.role} | ${u.activo ? 'activa' : 'INACTIVA'}`;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  if (iRb !== -1) {
    const b = JSON.parse(fs.readFileSync(args[iRb + 1], 'utf8'));
    await User.updateOne({ _id: b._id }, { $set: { role: b.role, activo: b.activo } });
    console.log(`Restaurado ${b.email}: rol ${b.role}, ${b.activo ? 'activa' : 'inactiva'}`);
    return mongoose.disconnect();
  }

  if (iBus !== -1) {
    const re = new RegExp(esc(args[iBus + 1] || ''), 'i');
    const us = await User.find({ $or: [{ nombre: re }, { email: re }] }).select('email nombre role activo');
    console.log(us.length ? us.map(fila).join('\n') : 'Sin coincidencias.');
    return mongoose.disconnect();
  }

  if (!email) throw new Error('Uso: node scripts/promover-admin.js <email> [--write]  |  --buscar "texto"');
  const u = await User.findOne({ email: email.toLowerCase().trim() }).select('email nombre role activo');
  if (!u) throw new Error(`No existe una cuenta con ${email}`);
  console.log(`Antes:   ${fila(u)}`);
  const cambio = DESACTIVAR ? { role: u.role, activo: false } : { role: 'admin', activo: true };
  if (u.role === cambio.role && u.activo === cambio.activo) { console.log('Ya está así; no hay nada que cambiar.'); return mongoose.disconnect(); }
  if (DESACTIVAR && u.role === 'admin' && (await User.countDocuments({ role: 'admin', activo: true, _id: { $ne: u._id } })) === 0) {
    throw new Error('Es el único administrador activo; no se puede desactivar.');
  }
  console.log(`Después: ${u.email} | rol: ${cambio.role} | ${cambio.activo ? 'activa' : 'INACTIVA'}`);
  if (!WRITE) { console.log('\nSimulación: no se escribió nada. Agrega --write para aplicar.'); return mongoose.disconnect(); }

  const dir = path.join(__dirname, '../data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `rol-antes-${u.email.replace(/[^a-z0-9]+/gi, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ _id: u._id, email: u.email, role: u.role, activo: u.activo }, null, 2));
  await User.updateOne({ _id: u._id }, { $set: cambio });
  console.log(`\nRespaldo: ${archivo}`);
  console.log(DESACTIVAR
    ? `Listo: ${u.email} desactivada; ya no puede iniciar sesión ni usar la API.`
    : `Listo: ${u.email} ahora es administrador. Debe cerrar sesión y volver a entrar.`);
  console.log(`Para revertir: node scripts/promover-admin.js --rollback "${archivo}"`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await mongoose.disconnect(); process.exit(1); });
