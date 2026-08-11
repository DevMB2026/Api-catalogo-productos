const mongoose = require('mongoose');

// Conexión a MongoDB Atlas. Se llama desde server.js antes de levantar el servidor,
// para no aceptar peticiones si la base de datos no está disponible.
async function connectDB(uri) {
  await mongoose.connect(uri);
  console.log('Conectado exitosamente a MongoDB 🍃');
}

module.exports = connectDB;
