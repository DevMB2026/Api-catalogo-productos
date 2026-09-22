const crypto = require('crypto');
const ClientApiKey = require('../models/clientApiKey.model');
const { hashKey } = require('./apiKey.service');

const PREFIX = 'cli_';

// Misma receta que las llaves de distribuidor (CSPRNG, 24 bytes → 48 hex,
// SHA-256 al guardar), con otro prefijo para distinguirlas a simple vista.
function generateRawKey() {
  return PREFIX + crypto.randomBytes(24).toString('hex');
}

// Una sola llave activa por cliente: generar una nueva desactiva la anterior
// (así "regenerar" corta de inmediato una llave filtrada). Devuelve la llave
// en CLARO — es la única vez que existe fuera de la base de datos.
async function createClientKeyForUser(userId) {
  await ClientApiKey.updateMany({ user: userId, activo: true }, { activo: false });
  const raw = generateRawKey();
  const doc = await ClientApiKey.create({
    user: userId,
    hash: hashKey(raw),
    prefijo: raw.slice(0, PREFIX.length + 8) + '…'
  });
  return { raw, doc };
}

async function revokeClientKeysForUser(userId) {
  const r = await ClientApiKey.updateMany({ user: userId, activo: true }, { activo: false });
  return r.modifiedCount;
}

module.exports = { PREFIX, createClientKeyForUser, revokeClientKeysForUser };
