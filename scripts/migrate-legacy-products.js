/**
 * Migración de productos del esquema VIEJO al NUEVO (multi-marca).
 *
 * Detecta documentos legados (los que NO tienen el campo `brand`) y los adapta:
 *   - marca (String)      -> Brand (colección, ref)   usando BRAND_MAP
 *   - categoria (faltante)-> Category placeholder "Sin categoría"  [REVISAR]
 *   - colores/talla/imagenes -> variants[]
 *   - infoAdicional.tablaMedidas -> sizeGuide[]
 *   - infoAdicional.preguntasFrecuentes -> faq[]
 *   - detalles (String)   -> infoAdicional (texto libre)
 *   - genera sku y slug únicos
 *
 * Uso:
 *   node scripts/migrate-legacy-products.js --dry-run   (previsualiza, no escribe)
 *   node scripts/migrate-legacy-products.js             (aplica los cambios)
 *
 * Es idempotente: los docs ya migrados tienen `brand`, así que no se vuelven a tocar.
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const slugify = require('slugify');
const Brand = require('../src/models/brand.model');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const { generateUniqueSku, generateUniqueSlug } = require('../src/utils/slug');

const DRY = process.argv.includes('--dry-run');

// Texto sucio de marca -> marca canónica. Amplía este mapa según haga falta.
const BRAND_MAP = {
  'fit be fresh': { nombre: 'FitBeFresh', slug: 'fitbefresh', dominio: 'fitbefresh.com' },
  'fitbefresh': { nombre: 'FitBeFresh', slug: 'fitbefresh', dominio: 'fitbefresh.com' },
  'prezenza': { nombre: 'Prezenza', slug: 'prezenza', dominio: 'prezenza.com' },
  'la casa de la chamarra': { nombre: 'La Casa de la Chamarra', slug: 'lacasadelachamarra', dominio: 'lacasadelachamarra.com' },
  'la casa de la playera': { nombre: 'La Casa de la Playera', slug: 'lacasadelaplayera', dominio: 'lacasadelaplayera.com' },
  'uniformes qro': { nombre: 'Uniformes QRO', slug: 'uniformesqro', dominio: 'uniformesqro.com' },
  'uniformes mty': { nombre: 'Uniformes MTY', slug: 'uniformesmty', dominio: 'uniformesmty.mx' },
  'be fresh security': { nombre: 'Be Fresh Security', slug: 'befreshsecurity', dominio: 'befreshsecurity.com' }
};

// Categoría temporal para productos legados sin categoría; el admin debe reasignar.
const CATEGORIA_REVISION = { nombre: 'Sin categoría', slug: 'sin-categoria' };

async function findOrCreateBrand(marcaTexto) {
  const key = String(marcaTexto || '').trim().toLowerCase();
  const mapped = BRAND_MAP[key];
  const nombre = mapped ? mapped.nombre : (marcaTexto || 'Sin marca');
  const slug = mapped ? mapped.slug : slugify(nombre, { lower: true, strict: true });
  let brand = await Brand.findOne({ slug });
  if (!brand && !DRY) brand = await Brand.create({ nombre, slug, dominio: mapped && mapped.dominio });
  return brand || { _id: '(dry)', slug, nombre };
}

async function findOrCreateCategoriaRevision() {
  let cat = await Category.findOne({ slug: CATEGORIA_REVISION.slug });
  if (!cat && !DRY) cat = await Category.create(CATEGORIA_REVISION);
  return cat || { _id: '(dry)', slug: CATEGORIA_REVISION.slug };
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('Falta MONGO_URI en .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Conectado a MongoDB. Modo: ${DRY ? 'DRY-RUN (sin escribir)' : 'APLICAR CAMBIOS'}\n`);

  // Leemos en crudo para NO perder campos que el esquema nuevo ya no reconoce.
  const col = mongoose.connection.collection('products');
  const legacy = await col.find({ brand: { $exists: false } }).toArray();
  console.log(`Documentos legados encontrados: ${legacy.length}`);

  let migrados = 0;
  for (const old of legacy) {
    const brand = await findOrCreateBrand(old.marca);
    const category = await findOrCreateCategoriaRevision();
    const slug = DRY ? slugify(String(old.nombre || 'item'), { lower: true, strict: true }) : await generateUniqueSlug(Product, old.nombre);
    const sku = DRY ? (slugify(String(old.nombre || 'SKU'), { lower: false, strict: true }).toUpperCase()) : await generateUniqueSku(Product, old.nombre);

    const colores = Array.isArray(old.colores) && old.colores.length ? old.colores : ['Único'];
    const tallas = Array.isArray(old.talla) ? old.talla : [];
    const imagenesViejas = Array.isArray(old.imagenes) ? old.imagenes : [];

    // Una variante por color. La imagen legada (sin public_id real) se coloca en
    // la PRIMERA variante como principal, porque no sabíamos su color original.
    const variants = colores.map((color, i) => ({
      color,
      tallas,
      imagenes: (i === 0 ? imagenesViejas : []).map((url, j) => ({
        url,
        public_id: `legacy/${slug}/${i}-${j}`, // placeholder; se reemplaza al migrar a Cloudinary
        principal: j === 0
      })),
      principal: i === 0
    }));

    const info = old.infoAdicional || {};
    const sizeGuide = Array.isArray(info.tablaMedidas)
      ? info.tablaMedidas.map((m) => ({ talla: m.talla, medidas: m.medidas }))
      : [];
    const faq = Array.isArray(info.preguntasFrecuentes)
      ? info.preguntasFrecuentes.map((f) => ({ pregunta: f.pregunta, respuesta: f.respuesta }))
      : [];

    console.log(`\nLegado: "${old.nombre}" (marca "${old.marca}")`);
    console.log(`  -> brand=${brand.slug}, category=${category.slug} [REVISAR], sku=${sku}, slug=${slug}`);
    console.log(`     variants=${variants.length} (colores: ${colores.join(', ')}), sizeGuide=${sizeGuide.length}, faq=${faq.length}`);
    if (imagenesViejas.length) {
      console.log(`     ⚠ imagen legada con public_id placeholder — reemplazar al pasar a Cloudinary`);
    }

    if (DRY) continue;

    const created = await Product.create({
      nombre: old.nombre,
      sku,
      slug,
      descripcion: old.descripcion,
      brand: brand._id,
      category: category._id,
      sexo: old.sexo || 'unisex',
      infoAdicional: old.detalles, // el texto libre viejo va aquí
      variants,
      sizeGuide,
      faq,
      activo: old.activo !== false
    });

    // Preserva las fechas originales de creación/actualización.
    await col.updateOne(
      { _id: created._id },
      { $set: { createdAt: old.createdAt || created.createdAt, updatedAt: old.updatedAt || created.updatedAt } }
    );

    // Elimina el documento viejo SOLO tras crear el nuevo con éxito.
    await col.deleteOne({ _id: old._id });
    console.log(`  ✔ migrado a _id=${created._id}; documento viejo eliminado`);
    migrados++;
  }

  await mongoose.disconnect();
  console.log(`\n${DRY ? 'DRY-RUN completo.' : `Migración completa: ${migrados} producto(s) migrado(s).`}`);
  if (legacy.length) console.log('Recuerda reasignar la categoría de los productos marcados [REVISAR].');
}

run().catch((err) => { console.error('Error en la migración:', err); process.exit(1); });
