/**
 * Reemplaza las fotos de "CHAMARRA REACTION" (Prezenza, slug
 * chamarra-reaction) por las fotos reales del cliente: 4 colores (marino,
 * negro, rojo, verde), 4 fotos cada uno (2 caballero + 2 dama). El producto
 * tiene un 5to color (VINO) sin fotos nuevas — se deja intacto.
 *
 *   node scripts/actualizar-imagenes-chamarra-reaction.js
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const cloudinary = require('../src/config/cloudinary');
const { uploadBuffer, destroy } = require('../src/services/cloudinary.service');

const SLUG = 'chamarra-reaction';
const IMG_DIR = 'C:/Users/MKT-WEB-DIS/Downloads/CHAMARRA REACTION-20260827T171426Z-1-001/CHAMARRA REACTION';

const FOTOS = [
  { archivo: 'Reaction marino 1 caballero.jpg', colorSku: 'AZUL-MARINO', tag: 'marino-caballero-1', sexo: 'hombre' },
  { archivo: 'Reaction marino 3 caballero.jpg', colorSku: 'AZUL-MARINO', tag: 'marino-caballero-2', sexo: 'hombre' },
  { archivo: 'Reaction marino 2 dama.jpg', colorSku: 'AZUL-MARINO', tag: 'marino-dama-1', sexo: 'mujer' },
  { archivo: 'Reaction marino 4 dama.jpg', colorSku: 'AZUL-MARINO', tag: 'marino-dama-2', sexo: 'mujer' },
  { archivo: 'Reaction negro 3 caballero.jpg', colorSku: 'NEGRO', tag: 'negro-caballero-1', sexo: 'hombre' },
  { archivo: 'Reaction negro 4 caballero.jpg', colorSku: 'NEGRO', tag: 'negro-caballero-2', sexo: 'hombre' },
  { archivo: 'Reaction negro 1 dama.jpg', colorSku: 'NEGRO', tag: 'negro-dama-1', sexo: 'mujer' },
  { archivo: 'Reaction negro 2 dama.jpg', colorSku: 'NEGRO', tag: 'negro-dama-2', sexo: 'mujer' },
  { archivo: 'Reaction rojo 1 caballero.jpg', colorSku: 'ROJO', tag: 'rojo-caballero-1', sexo: 'hombre' },
  { archivo: 'Reaction rojo 2 caballero.jpg', colorSku: 'ROJO', tag: 'rojo-caballero-2', sexo: 'hombre' },
  { archivo: 'Reaction rojo 3 dama.jpg', colorSku: 'ROJO', tag: 'rojo-dama-1', sexo: 'mujer' },
  { archivo: 'Reaction rojo 4 dama.jpg', colorSku: 'ROJO', tag: 'rojo-dama-2', sexo: 'mujer' },
  { archivo: 'Reaction verde 1 caballero.jpg', colorSku: 'VERDE', tag: 'verde-caballero-1', sexo: 'hombre' },
  { archivo: 'Reaction verde 4 caballero.jpg', colorSku: 'VERDE', tag: 'verde-caballero-2', sexo: 'hombre' },
  { archivo: 'Reaction verde 2 dama.jpg', colorSku: 'VERDE', tag: 'verde-dama-1', sexo: 'mujer' },
  { archivo: 'Reaction verde 3 dama.jpg', colorSku: 'VERDE', tag: 'verde-dama-2', sexo: 'mujer' }
];

async function main() {
  if (!cloudinary.isConfigured()) { console.error('Cloudinary no configurado (.env).'); process.exit(1); }
  const Product = require('../src/models/product.model');
  await mongoose.connect(process.env.MONGO_URI);

  const product = await Product.findOne({ slug: SLUG });
  if (!product) { console.error(`No existe el producto "${SLUG}"`); process.exit(1); }
  console.log(`▸ ${product.nombre} (${product.sku}) — ${product.variants.length} variantes`);

  const folder = `catalogo/prezenza/${product.sku}`;
  const mediaByColor = {};

  for (const f of FOTOS) {
    const filePath = path.join(IMG_DIR, f.archivo);
    const buffer = fs.readFileSync(filePath);
    const publicId = `${folder}/${f.tag}`;
    const result = await uploadBuffer(buffer, undefined, { public_id: publicId, overwrite: true, resource_type: 'image' }); // eslint-disable-line no-await-in-loop
    (mediaByColor[f.colorSku] = mediaByColor[f.colorSku] || []).push({ url: result.secure_url, public_id: result.public_id, sexo: f.sexo });
    console.log(`  ✓ subida: ${f.archivo} -> ${result.public_id} (${f.colorSku}, ${f.sexo})`);
  }

  const reordenar = (arr) => arr.map((m, i) => ({ url: m.url, public_id: m.public_id, sexo: m.sexo, orden: i, principal: i === 0, tipo: 'image' }));

  // Solo se borran fotos viejas de los colores que SÍ se reemplazan (VINO se queda intacto).
  const idsViejos = new Set();
  product.variants.forEach((v) => {
    const colorSku = Object.keys(mediaByColor).find((c) => v.sku.includes(`-${c}-`) || v.sku.endsWith(`-${c}`));
    if (colorSku) v.media.forEach((m) => idsViejos.add(m.public_id));
  });

  let actualizadas = 0;
  for (const v of product.variants) {
    const colorSku = Object.keys(mediaByColor).find((c) => v.sku.includes(`-${c}-`) || v.sku.endsWith(`-${c}`));
    if (colorSku) { v.media = reordenar(mediaByColor[colorSku]); actualizadas++; }
  }

  // Galería principal: solo los colores nuevos (marino, negro, rojo, verde); VINO no aporta aquí para no mezclar public_ids viejos con nuevos.
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
