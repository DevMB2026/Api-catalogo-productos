/**
 * Agrega (sin borrar las existentes) las fotos de la carpeta RENDER a
 * "Chamarra Atractive" (Prezenza) — así cada color queda con varias fotos en
 * la galería en vez de solo una por género. Usa public_id distintos (sufijo
 * "-render") para no pisar las fotos ya subidas por
 * actualizar-imagenes-chamarra-atractive.js.
 *
 *   node scripts/agregar-imagenes-render-chamarra-atractive.js
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const cloudinary = require('../src/config/cloudinary');
const { uploadBuffer } = require('../src/services/cloudinary.service');

const SLUG = 'chamarra-atractive';
const IMG_DIR = 'C:/Users/MKT-WEB-DIS/Downloads/CHAMARRA ATRACTIVE-20260827T161828Z-1-001/CHAMARRA ATRACTIVE/RENDER';

const FOTOS = [
  { archivo: 'MARINO DAMA.png', color: 'marino', sexo: 'mujer', nombre: 'marino-dama-render' },
  { archivo: 'MARINO.png', color: 'marino', sexo: null, nombre: 'marino-render' },
  { archivo: 'NEGRO CABALLERO.png', color: 'negro', sexo: 'hombre', nombre: 'negro-caballero-render' },
  { archivo: 'NEGRO DAMA.png', color: 'negro', sexo: 'mujer', nombre: 'negro-dama-render' }
];

async function main() {
  if (!cloudinary.isConfigured()) { console.error('Cloudinary no configurado (.env).'); process.exit(1); }
  const Product = require('../src/models/product.model');
  await mongoose.connect(process.env.MONGO_URI);

  const product = await Product.findOne({ slug: SLUG });
  if (!product) { console.error(`No existe el producto "${SLUG}"`); process.exit(1); }
  console.log(`▸ ${product.nombre} (${product.sku}) — ${product.variants.length} variantes`);

  const folder = `catalogo/prezenza/${product.sku}`;
  const nuevasPorColor = { marino: [], negro: [] };

  for (const f of FOTOS) {
    const filePath = path.join(IMG_DIR, f.archivo);
    const buffer = fs.readFileSync(filePath);
    const publicId = `${folder}/${f.nombre}`;
    const result = await uploadBuffer(buffer, undefined, { public_id: publicId, overwrite: true, resource_type: 'image' }); // eslint-disable-line no-await-in-loop
    nuevasPorColor[f.color].push({ url: result.secure_url, public_id: result.public_id, tipo: 'image', sexo: f.sexo });
    console.log(`  ✓ subida: RENDER/${f.archivo} -> ${result.public_id}`);
  }

  const reordenar = (arr) => arr.map((m, i) => ({ ...m, orden: i, principal: i === 0 }));

  let actualizadas = 0;
  for (const v of product.variants) {
    if (v.sku.includes('AZUL-MARINO')) { v.media = reordenar([...v.media.map((m) => m.toObject()), ...nuevasPorColor.marino]); actualizadas++; }
    else if (v.sku.includes('NEGRO')) { v.media = reordenar([...v.media.map((m) => m.toObject()), ...nuevasPorColor.negro]); actualizadas++; }
  }

  // Galería principal: negro primero (como ya era), luego marino, con las nuevas al final de cada bloque.
  const negroGaleria = [...product.media.filter((m) => m.public_id.includes('/negro')).map((m) => m.toObject()), ...nuevasPorColor.negro];
  const marinoGaleria = [...product.media.filter((m) => m.public_id.includes('/marino')).map((m) => m.toObject()), ...nuevasPorColor.marino];
  product.media = reordenar([...negroGaleria, ...marinoGaleria]);

  await product.save();
  console.log(`✓ ${actualizadas} variantes actualizadas + galería del producto (${product.media.length} fotos en total).`);

  await mongoose.disconnect();
  console.log('\nListo.');
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
