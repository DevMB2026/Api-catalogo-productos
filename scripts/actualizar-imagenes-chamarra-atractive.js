/**
 * Reemplaza las fotos de "Chamarra Atractive" (Prezenza): sube las 4 fotos
 * nuevas (marino/negro x caballero/dama) a Cloudinary, las asigna a las
 * variantes de cada color (mismas fotos en todas las tallas de ese color,
 * como ya hace migrate-images-cloudinary.js), actualiza la galería principal
 * del producto y borra de Cloudinary las fotos viejas que quedan huérfanas.
 *
 *   node scripts/actualizar-imagenes-chamarra-atractive.js
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const cloudinary = require('../src/config/cloudinary');
const { uploadBuffer, destroy } = require('../src/services/cloudinary.service');

const SLUG = 'chamarra-atractive';
const IMG_DIR = 'C:/Users/MKT-WEB-DIS/Downloads/CHAMARRA ATRACTIVE-20260827T161828Z-1-001/CHAMARRA ATRACTIVE/Chamarra atractive';

const FOTOS = [
  { archivo: 'MARINO CABALLERO.png', color: 'marino', sexo: 'hombre' },
  { archivo: 'MARINO DAMA.png', color: 'marino', sexo: 'mujer' },
  { archivo: 'NEGRO CABALLERO.png', color: 'negro', sexo: 'hombre' },
  { archivo: 'NEGRO DAMA.png', color: 'negro', sexo: 'mujer' }
];

const buildMedia = (arr) => arr.map((m) => ({ ...m }));

async function main() {
  if (!cloudinary.isConfigured()) { console.error('Cloudinary no configurado (.env).'); process.exit(1); }
  const Product = require('../src/models/product.model');
  await mongoose.connect(process.env.MONGO_URI);

  const product = await Product.findOne({ slug: SLUG });
  if (!product) { console.error(`No existe el producto "${SLUG}"`); process.exit(1); }
  console.log(`▸ ${product.nombre} (${product.sku}) — ${product.variants.length} variantes`);

  const folder = `catalogo/prezenza/${product.sku}`;
  const mediaByColor = { marino: [], negro: [] };

  for (const f of FOTOS) {
    const filePath = path.join(IMG_DIR, f.archivo);
    const buffer = fs.readFileSync(filePath);
    const publicId = `${folder}/${f.color}-${f.sexo === 'hombre' ? 'caballero' : 'dama'}`;
    const result = await uploadBuffer(buffer, undefined, { public_id: publicId, overwrite: true, resource_type: 'image' }); // eslint-disable-line no-await-in-loop
    mediaByColor[f.color].push({
      url: result.secure_url,
      public_id: result.public_id,
      orden: mediaByColor[f.color].length,
      principal: mediaByColor[f.color].length === 0,
      tipo: 'image',
      sexo: f.sexo
    });
    console.log(`  ✓ subida: ${f.archivo} -> ${result.public_id}`);
  }

  // public_ids actuales, para saber cuáles quedan huérfanos después de reasignar.
  const idsViejos = new Set();
  product.media.forEach((m) => idsViejos.add(m.public_id));
  product.variants.forEach((v) => v.media.forEach((m) => idsViejos.add(m.public_id)));

  let actualizadas = 0;
  for (const v of product.variants) {
    if (v.sku.includes('AZUL-MARINO')) { v.media = buildMedia(mediaByColor.marino); actualizadas++; }
    else if (v.sku.includes('NEGRO')) { v.media = buildMedia(mediaByColor.negro); actualizadas++; }
  }

  // Galería principal del producto (tarjeta del catálogo): negro primero (como ya era), luego marino.
  product.media = [...buildMedia(mediaByColor.negro), ...buildMedia(mediaByColor.marino)]
    .map((m, i) => ({ ...m, orden: i, principal: i === 0 }));

  await product.save();
  console.log(`✓ ${actualizadas} variantes actualizadas + galería del producto (${product.media.length} fotos).`);

  const idsNuevos = new Set([...mediaByColor.marino, ...mediaByColor.negro].map((m) => m.public_id));
  const aBorrar = [...idsViejos].filter((id) => !idsNuevos.has(id));
  for (const id of aBorrar) {
    try { await destroy(id); console.log(`  🗑 borrada de Cloudinary: ${id}`); } // eslint-disable-line no-await-in-loop
    catch (e) { console.warn(`  ! no se pudo borrar ${id}: ${e.message}`); }
  }

  await mongoose.disconnect();
  console.log('\nListo.');
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
