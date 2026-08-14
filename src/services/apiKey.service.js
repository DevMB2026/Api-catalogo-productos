const crypto = require('crypto');
const ApiKey = require('../models/apiKey.model');

const PREFIX = 'dist_';

// Key aleatoria criptográficamente segura (CSPRNG, no Math.random): 24 bytes
// de entropía → 48 caracteres hex, con prefijo para identificarla a simple vista.
function generateRawKey() {
  return PREFIX + crypto.randomBytes(24).toString('hex');
}

// SHA-256 alcanza aquí (a diferencia de bcrypt para passwords): la key ya nace
// con altísima entropía aleatoria — no existe "diccionario" que probar contra
// ella — así que no hace falta un hash lento, solo que sea irreversible.
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// Crea la API Key activa de un distribuidor. Por ahora se admite UNA activa a
// la vez (se desactivan las anteriores); el modelo ya soporta varias por
// usuario si en el futuro se necesita rotación sin downtime.
// Devuelve la key en CLARO — es la única vez que existirá fuera de la DB.
async function createApiKeyForUser(userId, { nombre } = {}) {
  await ApiKey.updateMany({ user: userId, activo: true }, { activo: false });

  const raw = generateRawKey();
  const hash = hashKey(raw);
  const prefijo = raw.slice(0, PREFIX.length + 8) + '…';

  const doc = await ApiKey.create({ user: userId, hash, prefijo, nombre: nombre || 'Principal' });
  return { raw, doc };
}

module.exports = { generateRawKey, hashKey, createApiKeyForUser };
