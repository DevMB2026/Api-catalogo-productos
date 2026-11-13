/**
 * Crea la copia JPG (fondo blanco, máx. 1600 px) de cada foto .webp del bucket R2.
 * Solo AGREGA archivos .jpg junto a los .webp: no modifica ni borra nada.
 * Es reanudable: si el .jpg ya existe, lo salta.
 *
 *   node scripts/generar-jpg-r2.js                 (simulación: cuenta, no sube)
 *   node scripts/generar-jpg-r2.js --limit=5       (simulación con las primeras 5)
 *   node scripts/generar-jpg-r2.js --write         (sube los JPG)
 *   node scripts/generar-jpg-r2.js --write --limit=5
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { r2, r2Configured, toJpeg } = require('../src/services/storage.service');

const WRITE = process.argv.includes('--write');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const PREFIX = 'catalogo/';
const CONCURRENCY = 6;

async function listWebp(Bucket) {
  const keys = [];
  let token;
  do {
    const r = await r2().send(new ListObjectsV2Command({ Bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents || []) if (/\.webp$/i.test(o.Key)) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

const existe = (Bucket, Key) => r2().send(new HeadObjectCommand({ Bucket, Key })).then(() => true).catch(() => false);

async function main() {
  if (!r2Configured()) { console.error('R2 no está configurado en .env'); process.exit(1); }
  const Bucket = process.env.R2_BUCKET;
  const webps = (await listWebp(Bucket)).slice(0, LIMIT);
  console.log(`${WRITE ? 'MODO ESCRITURA' : 'SIMULACIÓN'} · fotos .webp en ${PREFIX}: ${webps.length}`);
  const st = { creadas: 0, ya_existian: 0, errores: 0, bytes_webp: 0, bytes_jpg: 0 };
  let i = 0;
  async function worker() {
    while (i < webps.length) {
      const k = webps[i++];
      const kj = k.replace(/\.webp$/i, '.jpg');
      try {
        if (await existe(Bucket, kj)) { st.ya_existian++; continue; }
        if (!WRITE) { st.creadas++; continue; }
        const obj = await r2().send(new GetObjectCommand({ Bucket, Key: k }));
        const buf = Buffer.from(await obj.Body.transformToByteArray());
        const jpg = await toJpeg(buf);
        await r2().send(new PutObjectCommand({ Bucket, Key: kj, Body: jpg, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
        st.creadas++; st.bytes_webp += buf.length; st.bytes_jpg += jpg.length;
      } catch (e) {
        st.errores++; console.log('  !!', k, e.message);
      }
      if ((st.creadas + st.ya_existian + st.errores) % 100 === 0) console.log(`  ${st.creadas + st.ya_existian + st.errores}/${webps.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('\n=== Resumen ===');
  console.log({ ...st, MB_webp: (st.bytes_webp / 1048576).toFixed(1), MB_jpg: (st.bytes_jpg / 1048576).toFixed(1) });
  if (!WRITE) console.log('(simulación: no se subió nada; usa --write para crear los JPG)');
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
