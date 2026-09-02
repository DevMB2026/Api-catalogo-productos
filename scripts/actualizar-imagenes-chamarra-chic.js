/**
 * Reemplaza las fotos de "CHAMARRA CHIC" (Prezenza, slug chamarra-chic) por
 * las fotos reales del cliente: 2 colores (marino, negro), marino con 2
 * caballero + 1 dama, negro con 2 caballero (frente y espalda) + 1 dama.
 * Mismo patrón que los scripts anteriores de este catálogo.
 *
 *   node scripts/actualizar-imagenes-chamarra-chic.js
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const cloudinary = require('../src/config/cloudinary');
const { uploadBuffer, destroy } = require('../src/services/cloudinary.service');

const SLUG = 'chamarra-chic';
const IMG_DIR = 'C:/Users/MKT-WEB-DIS/Downloads/CHAMARRA CHIC-20260827T162555Z-1-001/CHAMARRA CHIC/chic';

const FOTOS = [
  { archivo: 'MARINO CABALLERO 1.png', colorSku: 'AZUL-MARINO', tag: 'marino-caballero-1', sexo: 'hombre' },
  { archivo: 'MARINO CABALLERO 2.png', colorSku: 'AZUL-MARINO', tag: 'marino-caballero-2', sexo: 'hombre' },
  { archivo: 'MARINO DAMA.png', colorSku: 'AZUL-MARINO', tag: 'marino-dama-1', sexo: 'mujer' },
  { archivo: 'NEGRO CABALLERO.png', colorSku: 'NEGRO', tag: 'negro-caballero-1', sexo: 'hombre' },
  { archivo: 'NEGRO DETRAS caballero.png', colorSku: 'NEGRO', tag: 'negro-caballero-2-espalda', sexo: 'hombre' },
  { archivo: 'NEGRO DAMA.png', colorSku: 'NEGRO', tag: 'negro-dama-1', sexo: 'mujer' }
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

  const idsViejos = new Set();
  product.media.forEach((m) => idsViejos.add(m.public_id));
  product.variants.forEach((v) => v.media.forEach((m) => idsViejos.add(m.public_id)));

  let actualizadas = 0;
  for (const v of product.variants) {
    const colorSku = Object.keys(mediaByColor).find((c) => v.sku.includes(`-${c}-`) || v.sku.endsWith(`-${c}`));
    if (colorSku) { v.media = reordenar(mediaByColor[colorSku]); actualizadas++; }
  }

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
