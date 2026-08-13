/**
 * Importa data/prezenza-catalogo.json a la base de datos, resolviendo/creando
 * marcas, categorías (con jerarquía), opciones y valores, y luego los productos.
 *
 *   node scripts/import-prezenza.js            # DRY-RUN: no escribe, solo reporta
 *   node scripts/import-prezenza.js --write     # escribe de verdad
 *   node scripts/import-prezenza.js --write --force-products  # recrea productos existentes
 *
 * Idempotente: busca por slug antes de crear. Reutiliza las opciones/valores ya
 * sembrados (p. ej. Color/Talla con sus hex). Las 2 marcas se crean por separado.
 * Precios OMITIDOS (las variantes quedan en price 0 por defecto del modelo).
 * Imágenes: se guardan con la URL de prezenza.com y un public_id marcado
 * "prezenza-wp/…" (para verlas ya y poder migrarlas a Cloudinary después).
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const mongoose = require('mongoose');
const slugify = require('slugify');

const Brand = require('../src/models/brand.model');
const Category = require('../src/models/category.model');
const Option = require('../src/models/option.model');
const OptionValue = require('../src/models/optionValue.model');
const Product = require('../src/models/product.model');

const WRITE = process.argv.includes('--write');
const FORCE_PRODUCTS = process.argv.includes('--force-products');
const slug = (s) => slugify(String(s), { lower: true, strict: true, trim: true });

// Alias de slug de marca: WooCommerce trae "fit-be-fresh" pero tu marca canónica
// ya existe como "FitBeFresh" (slug fitbefresh). Evita crear un duplicado.
const BRAND_ALIAS = { 'fit-be-fresh': 'fitbefresh' };
const brandKeyOf = (p) => { const raw = p.brandSlug || slug(p.brand); return BRAND_ALIAS[raw] || raw; };

// --only=slugA,slugB  limita la CREACIÓN de productos a esos slugs (las marcas,
// categorías, opciones y valores se resuelven igual, reutilizando lo existente).
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)) : null;

const DATA = path.join(__dirname, '..', 'data', 'prezenza-catalogo.json');
const CATS = path.join(__dirname, '..', 'data', 'prezenza-categories.json');

const stats = { brands: 0, cats: 0, options: 0, values: 0, products: 0, variants: 0, skipped: 0, reused: 0 };

function publicIdFromUrl(url) {
  const file = url.split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '');
  return `prezenza-wp/${file}`;
}
function toMedia(arr) {
  return (arr || []).filter((m) => m.url).map((m, i) => ({
    url: m.url,
    public_id: publicIdFromUrl(m.url),
    alt: m.alt,
    orden: i,
    principal: !!m.principal || i === 0
  }));
}

// find-or-create genérico por filtro; en dry-run no escribe pero simula el doc.
async function foc(Model, filtro, datos, label, counterNew) {
  const found = await Model.findOne(filtro);
  if (found) { stats.reused++; return found; }
  if (!WRITE) {
    if (counterNew) stats[counterNew]++;
    console.log(`   + [nuevo] ${label}`);
    return { _id: new mongoose.Types.ObjectId(), ...datos, __simulated: true };
  }
  const created = await Model.create(datos);
  if (counterNew) stats[counterNew]++;
  console.log(`   + creado  ${label}`);
  return created;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`\n=== IMPORTACIÓN PREZENZA — ${WRITE ? 'MODO ESCRITURA' : 'DRY-RUN (no escribe)'} ===\n`);

  const productos = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
  const wooCats = JSON.parse(fs.readFileSync(CATS, 'utf-8'));

  // ---------- 1) MARCAS (por separado) ----------
  console.log('1) Marcas');
  const brandBySlug = {};
  const marcas = [...new Map(productos.map((p) => [brandKeyOf(p), { nombre: p.brand, slug: brandKeyOf(p) }])).values()];
  for (const m of marcas) {
    const b = await foc(Brand, { slug: m.slug }, { nombre: m.nombre, slug: m.slug }, `marca "${m.nombre}"`, 'brands');
    brandBySlug[m.slug] = b._id;
  }

  // ---------- 2) CATEGORÍAS (con jerarquía padre→hijo) ----------
  console.log('\n2) Categorías (jerarquía)');
  const byId = Object.fromEntries(wooCats.map((c) => [c.id, c]));
  const depth = (c) => { let d = 0, cur = c; while (cur && cur.parent) { cur = byId[cur.parent]; d++; if (d > 10) break; } return d; };
  const ordenadas = [...wooCats].sort((a, b) => depth(a) - depth(b)); // padres primero
  const catBySlug = {};
  for (const c of ordenadas) {
    const parentSlug = c.parent && byId[c.parent] ? byId[c.parent].slug : null;
    const parentId = parentSlug ? (catBySlug[parentSlug] || null) : null;
    const cat = await foc(Category, { slug: c.slug }, { nombre: c.name, slug: c.slug, parent: parentId }, `categoría "${c.name}"${parentSlug ? ' ⊂ ' + parentSlug : ''}`, 'cats');
    catBySlug[c.slug] = cat._id;
  }

  // ---------- 3) OPCIONES (Color / Talla) ----------
  console.log('\n3) Opciones');
  const colorOpt = await foc(Option, { slug: 'color' }, { nombre: 'Color', slug: 'color', tipo: 'swatch' }, 'opción Color', 'options');
  const tallaOpt = await foc(Option, { slug: 'talla' }, { nombre: 'Talla', slug: 'talla', tipo: 'size' }, 'opción Talla', 'options');

  // ---------- 4) VALORES (Color / Talla) ----------
  console.log('\n4) Valores de opción');
  const valId = {}; // `${optId}:${slug}` -> _id
  async function ensureValue(optId, valor) {
    const s = slug(valor);
    const key = `${optId}:${s}`;
    if (valId[key]) return valId[key];
    const v = await foc(OptionValue, { option: optId, slug: s }, { option: optId, valor, slug: s }, `valor ${valor}`, 'values');
    valId[key] = v._id;
    return v._id;
  }
  for (const p of productos) {
    for (const o of p.options || []) {
      const optId = o.nombre === 'Color' ? colorOpt._id : tallaOpt._id;
      for (const v of o.valores) await ensureValue(optId, v.nombre);
    }
  }

  // ---------- 5) PRODUCTOS ----------
  console.log('\n5) Productos');
  for (const p of productos) {
    if (ONLY && !ONLY.has(p.slug)) continue;
    const existente = await Product.findOne({ slug: p.slug });
    if (existente && !FORCE_PRODUCTS) { stats.skipped++; console.log(`   · ya existe: ${p.nombre}`); continue; }

    // options[] con refs
    const options = [];
    for (const o of p.options || []) {
      const optId = o.nombre === 'Color' ? colorOpt._id : tallaOpt._id;
      const values = [];
      for (const v of o.valores) values.push(await ensureValue(optId, v.nombre));
      options.push({ option: optId, values });
    }
    // variants[] resolviendo nombres de valor → ids
    const nameToId = {};
    for (const o of p.options || []) {
      const optId = o.nombre === 'Color' ? colorOpt._id : tallaOpt._id;
      for (const v of o.valores) nameToId[v.nombre] = await ensureValue(optId, v.nombre);
    }
    const variants = (p.variants || []).map((v) => ({
      sku: v.sku,
      optionValues: v.optionValues.map((n) => nameToId[n]).filter(Boolean),
      stock: v.stock || 0,
      media: toMedia(v.media)
    }));
    stats.variants += variants.length;

    const doc = {
      nombre: p.nombre,
      sku: p.sku,
      slug: p.slug,
      descripcion: p.descripcion || undefined,
      brand: brandBySlug[brandKeyOf(p)],
      category: p.categoriaSlug ? catBySlug[p.categoriaSlug] : undefined,
      sexo: p.sexo,
      attributes: [],
      options,
      variants,
      media: toMedia(p.media),
      destacado: false,
      activo: true
    };

    if (!WRITE) {
      stats.products++;
      console.log(`   + [nuevo] ${p.nombre}  (${p.brand} · ${p.categoria} · ${variants.length} variantes)`);
      continue;
    }
    if (existente && FORCE_PRODUCTS) { await existente.deleteOne(); }
    await Product.create(doc);
    stats.products++;
    console.log(`   + creado ${p.nombre}  (${variants.length} variantes)`);
  }

  // ---------- Resumen ----------
  console.log('\n=== RESUMEN ===');
  console.log(`Marcas nuevas:      ${stats.brands}`);
  console.log(`Categorías nuevas:  ${stats.cats}`);
  console.log(`Opciones nuevas:    ${stats.options}`);
  console.log(`Valores nuevos:     ${stats.values}`);
  console.log(`Productos a crear:  ${stats.products}`);
  console.log(`Variantes totales:  ${stats.variants}`);
  console.log(`Productos omitidos (ya existían): ${stats.skipped}`);
  console.log(`Refs reutilizadas (ya existían):  ${stats.reused}`);
  if (!WRITE) console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar.');

  await mongoose.disconnect();
}

run().catch((e) => { console.error('Error:', e); process.exit(1); });
