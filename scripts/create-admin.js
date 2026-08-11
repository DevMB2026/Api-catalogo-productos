/**
 * Crea (o actualiza la contraseña de) un usuario administrador.
 *
 * Uso:
 *   node scripts/create-admin.js <email> <password> ["Nombre opcional"]
 * o con variables de entorno:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/create-admin.js
 *
 * La contraseña la eliges tú al ejecutarlo; el script no la muestra ni la guarda
 * en claro (el modelo la hashea con bcrypt).
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const User = require('../src/models/user.model');

async function run() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;
  const nombre = process.argv[4] || process.env.ADMIN_NOMBRE || 'Administrador';

  if (!email || !password) {
    console.error('Faltan datos. Uso: node scripts/create-admin.js <email> <password> ["Nombre"]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('La contraseña debe tener al menos 8 caracteres.');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('Falta MONGO_URI en .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  let user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    user.password = password; // el pre('save') la re-hashea
    user.nombre = nombre;
    user.activo = true;
    await user.save();
    console.log(`✔ Admin actualizado: ${user.email}`);
  } else {
    user = await User.create({ email, password, nombre, role: 'admin' });
    console.log(`✔ Admin creado: ${user.email}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => { console.error('Error creando admin:', err.message); process.exit(1); });
