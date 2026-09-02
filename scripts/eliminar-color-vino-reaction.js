/**
 * Elimina por completo el color VINO de "CHAMARRA REACTION" (Prezenza,
 * slug chamarra-reaction): borra sus 7 variantes de talla, quita el
 * OptionValue "Vino" de product.options (para que ya no aparezca como
 * opción de color) y borra sus fotos de Cloudinary.
 *
 *   node scripts/eliminar-color-vino-reaction.js
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const cloudinary = require('../src/config/cloudinary');
const { destroy } = require('../src/services/cloudinary.service');

const SLUG = 'chamarra-reaction';
const VINO_OPTION_VALUE_ID = '6a7decb03d905ef7b12aa692';

async function main() {
  if (!cloudinary.isConfigured()) { console.error('Cloudinary no configurado (.env).'); process.exit(1); }
  const Product = require('../src/models/product.model');
  await mongoose.connect(process.env.MONGO_URI);

  const product = await Product.findOne({ slug: SLUG });
  if (!product) { console.error(`No existe el producto "${SLUG}"`); process.exit(1); }
  console.log(`▸ ${product.nombre} (${product.sku}) — ${product.variants.length} variantes antes`);

  const vinoVariants = product.variants.filter((v) => v.optionValues.some((id) => String(id) === VINO_OPTION_VALUE_ID));
  console.log(`  ${vinoVariants.length} variantes VINO a eliminar: ${vinoVariants.map((v) => v.sku).join(', ')}`);

  const idsABorrar = vinoVariants.flatMap((v) => v.media.map((m) => m.public_id));

  product.variants = product.variants.filter((v) => !v.optionValues.some((id) => String(id) === VINO_OPTION_VALUE_ID));

  const colorAxis = product.options.find((o) => o.values.some((id) => String(id) === VINO_OPTION_VALUE_ID));
  if (colorAxis) colorAxis.values = colorAxis.values.filter((id) => String(id) !== VINO_OPTION_VALUE_ID);

  await product.save();
  console.log(`✓ ${product.variants.length} variantes después. Color VINO quitado de options.`);

  for (const id of idsABorrar) {
    try { await destroy(id); console.log(`  🗑 borrada de Cloudinary: ${id}`); } // eslint-disable-line no-await-in-loop
    catch (e) { console.warn(`  ! no se pudo borrar ${id}: ${e.message}`); }
  }

  await mongoose.disconnect();
  console.log('\nListo.');
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
