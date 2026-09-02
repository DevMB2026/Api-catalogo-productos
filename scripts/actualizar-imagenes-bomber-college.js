/**
 * Reemplaza las fotos de "BOMBER COLLEGE UNISEX" (Prezenza, slug
 * bomber-college-unisex) por las fotos reales del cliente, por color y
 * género. Mismo patrón que actualizar-imagenes-chamarra-atractive.js:
 * sube a Cloudinary, asigna a todas las tallas de cada color, actualiza la
 * galería del producto y borra las fotos viejas (photoroom) que quedan
 * huérfanas.
 *
 * Nota: el color "NEGRO" liso (sin manga de otro color) no tiene variante
 * propia en el producto (solo existen NEGRO-BLANCO y NEGRO-GRIS-OXFORD) —
 * se agrega como foto extra de NEGRO-GRIS-OXFORD, la más parecida.
 *
 *   node scripts/actualizar-imagenes-bomber-college.js
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const cloudinary = require('../src/config/cloudinary');
const { uploadBuffer, destroy } = require('../src/services/cloudinary.service');

const SLUG = 'bomber-college-unisex';
const IMG_DIR = 'C:/Users/MKT-WEB-DIS/Downloads/CHAMARRA COLLEGE/CHAMARRA COLLEGE/chamarra college';

// colorSku debe ser el fragmento que aparece en v.sku para identificar el color.
const FOTOS = [
  { archivo: 'MARINO GRIS  CABALLERO.png', colorSku: 'MARINO-GRIS-OXFORD', tag: 'oxford-caballero', sexo: 'hombre' },
  { archivo: 'MARINO GRIS  DAMA.png', colorSku: 'MARINO-GRIS-OXFORD', tag: 'oxford-dama', sexo: 'mujer' },
  { archivo: 'MARINO GRIS  caballero (2).png', colorSku: 'MARINO-GRIS-JASPE', tag: 'jaspe-caballero', sexo: 'hombre' },
  { archivo: 'MARINO GRIS DAMA.png', colorSku: 'MARINO-GRIS-JASPE', tag: 'jaspe-dama', sexo: 'mujer' },
  { archivo: 'NEGRO BLANCO caballero.png', colorSku: 'NEGRO-BLANCO', tag: 'negro-blanco-caballero', sexo: 'hombre' },
  { archivo: 'NEGRO BLANCO DAMA.png', colorSku: 'NEGRO-BLANCO', tag: 'negro-blanco-dama', sexo: 'mujer' },
  { archivo: 'NEGRO GRIS caballero.png', colorSku: 'NEGRO-GRIS-OXFORD', tag: 'negro-gris-caballero', sexo: 'hombre' },
  { archivo: 'NEGRO GRIS DAMA.png', colorSku: 'NEGRO-GRIS-OXFORD', tag: 'negro-gris-dama', sexo: 'mujer' },
  { archivo: 'NEGRO caballero.png', colorSku: 'NEGRO-GRIS-OXFORD', tag: 'negro-liso-caballero', sexo: 'hombre' },
  { archivo: 'NEGRO DAMA.png', colorSku: 'NEGRO-GRIS-OXFORD', tag: 'negro-liso-dama', sexo: 'mujer' },
  { archivo: 'REY GRIS caballero.png', colorSku: 'REY-GRIS', tag: 'rey-gris-caballero', sexo: 'hombre' },
  { archivo: 'REY GRIS DAMA.png', colorSku: 'REY-GRIS', tag: 'rey-gris-dama', sexo: 'mujer' },
  { archivo: 'ROJO NEGRO caballero.png', colorSku: 'ROJO-NEGRO', tag: 'rojo-negro-caballero', sexo: 'hombre' },
  { archivo: 'ROJO NEGRO DAMA.png', colorSku: 'ROJO-NEGRO', tag: 'rojo-negro-dama', sexo: 'mujer' }
];

async function main() {
  if (!cloudinary.isConfigured()) { console.error('Cloudinary no configurado (.env).'); process.exit(1); }
  const Product = require('../src/models/product.model');
  await mongoose.connect(process.env.MONGO_URI);

  const product = await Product.findOne({ slug: SLUG });
  if (!product) { console.error(`No existe el producto "${SLUG}"`); process.exit(1); }
  console.log(`▸ ${product.nombre} (${product.sku}) — ${product.variants.length} variantes`);

  const folder = `catalogo/prezenza/${product.sku}`;
  const mediaByColor = {}; // colorSku -> [{url, public_id, sexo}]

  for (const f of FOTOS) {
    const filePath = path.join(IMG_DIR, f.archivo);
    const buffer = fs.readFileSync(filePath);
    const publicId = `${folder}/${f.tag}`;
    const result = await uploadBuffer(buffer, undefined, { public_id: publicId, overwrite: true, resource_type: 'image' }); // eslint-disable-line no-await-in-loop
    (mediaByColor[f.colorSku] = mediaByColor[f.colorSku] || []).push({ url: result.secure_url, public_id: result.public_id, sexo: f.sexo });
    console.log(`  ✓ subida: ${f.archivo} -> ${result.public_id} (${f.colorSku}, ${f.sexo})`);
  }

  const reordenar = (arr) => arr.map((m, i) => ({ url: m.url, public_id: m.public_id, sexo: m.sexo, orden: i, principal: i === 0, tipo: 'image' }));

  const idsViejos = new Set();
  product.media.forEach((m) => idsViejos.add(m.public_id));
  product.variants.forEach((v) => v.media.forEach((m) => idsViejos.add(m.public_id)));

  let actualizadas = 0;
  for (const v of product.variants) {
    const colorSku = Object.keys(mediaByColor).find((c) => v.sku.includes(`-${c}-`) || v.sku.endsWith(`-${c}`));
    if (colorSku) { v.media = reordenar(mediaByColor[colorSku]); actualizadas++; }
  }

  // Galería principal: todas las fotos nuevas, agrupadas por color en el mismo orden del array FOTOS.
  const ordenColores = [...new Set(FOTOS.map((f) => f.colorSku))];
  const galeria = ordenColores.flatMap((c) => mediaByColor[c]);
  product.media = reordenar(galeria);

  await product.save();
  console.log(`✓ ${actualizadas} variantes actualizadas + galería del producto (${product.media.length} fotos).`);

  const idsNuevos = new Set(Object.values(mediaByColor).flat().map((m) => m.public_id));
  const aBorrar = [...idsViejos].filter((id) => !idsNuevos.has(id));
  for (const id of aBorrar) {
    try { await destroy(id); console.log(`  🗑 borrada de Cloudinary: ${id}`); } // eslint-disable-line no-await-in-loop
    catch (e) { console.warn(`  ! no se pudo borrar ${id}: ${e.message}`); }
  }

  await mongoose.disconnect();
  console.log('\nListo.');
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
