/**
 * Seed del motor PIM: crea los datos base para poder cargar productos
 * dinámicos. Idempotente (find-or-create): se puede correr varias veces.
 *
 *   node scripts/seed-pim.js
 *
 * Crea: Options (Color, Talla) + valores, Applications, AttributeDefinitions,
 * y ASIGNA atributos a las categorías existentes (required:false, para no romper
 * productos ya cargados; el admin puede marcarlos requeridos después).
 */
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const slugify = require('slugify');
const Option = require('../src/models/option.model');
const OptionValue = require('../src/models/optionValue.model');
const Application = require('../src/models/application.model');
const AttributeDefinition = require('../src/models/attributeDefinition.model');
const Category = require('../src/models/category.model');

const slug = (s) => slugify(String(s), { lower: true, strict: true });

async function findOrCreateOption(nombre, tipo) {
  const s = slug(nombre);
  let opt = await Option.findOne({ slug: s });
  if (!opt) opt = await Option.create({ nombre, slug: s, tipo });
  return opt;
}
async function findOrCreateValue(option, valor, meta) {
  const s = slug(valor);
  let v = await OptionValue.findOne({ option: option._id, slug: s });
  if (!v) v = await OptionValue.create({ option: option._id, valor, slug: s, meta });
  return v;
}
async function findOrCreateApplication(nombre) {
  const s = slug(nombre);
  let a = await Application.findOne({ slug: s });
  if (!a) a = await Application.create({ nombre, slug: s });
  return a;
}
async function findOrCreateAttribute(def) {
  let a = await AttributeDefinition.findOne({ key: def.key });
  if (!a) a = await AttributeDefinition.create(def);
  return a;
}

// Asigna (si faltan) atributos a una categoría por slug, required:false.
async function assignToCategory(categorySlug, attrDocs) {
  const cat = await Category.findOne({ slug: categorySlug });
  if (!cat) { console.log(`  (categoría no encontrada: ${categorySlug}, se omite)`); return; }
  const existing = new Set((cat.attributeDefs || []).map((d) => String(d.attribute)));
  let added = 0;
  for (const a of attrDocs) {
    if (!existing.has(String(a._id))) { cat.attributeDefs.push({ attribute: a._id, required: false }); added += 1; }
  }
  if (added) await cat.save();
  console.log(`  ${categorySlug}: +${added} atributos (total ${cat.attributeDefs.length})`);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Conectado. Sembrando PIM...\n');

  // 1) Options + valores
  const color = await findOrCreateOption('Color', 'swatch');
  const colores = [
    ['Negro', '#000000'], ['Blanco', '#FFFFFF'], ['Azul marino', '#1F3A5F'], ['Gris', '#808080'],
    ['Rojo', '#C0392B'], ['Verde', '#27AE60'], ['Azul', '#2980B9'], ['Naranja', '#E67E22'],
    ['Amarillo', '#F1C40F'], ['Rosa', '#E84393']
  ];
  for (const [nombre, hex] of colores) await findOrCreateValue(color, nombre, { hex });

  const talla = await findOrCreateOption('Talla', 'size');
  for (const t of ['XS', 'S', 'M', 'L', 'XL', 'XXL']) await findOrCreateValue(talla, t);
  console.log(`Options: Color (${colores.length} valores), Talla (6 valores)`);

  // 2) Applications
  for (const nombre of ['Bordado', 'DTF', 'Vinil', 'Sublimado']) await findOrCreateApplication(nombre);
  console.log('Applications: Bordado, DTF, Vinil, Sublimado');

  // 3) AttributeDefinitions
  const material = await findOrCreateAttribute({ key: 'material', label: 'Material', type: 'text', group: 'Tela', orden: 1 });
  const gramaje = await findOrCreateAttribute({ key: 'gramaje', label: 'Gramaje', type: 'number', unit: 'g/m²', filterable: true, group: 'Tela', orden: 2 });
  const cuidados = await findOrCreateAttribute({
    key: 'cuidados', label: 'Cuidados', type: 'multiselect', group: 'Tela', orden: 3,
    options: [
      { value: 'no_cloro', label: 'No usar cloro' }, { value: 'lavar_frio', label: 'Lavar en frío' },
      { value: 'no_planchar', label: 'No planchar' }, { value: 'secar_sombra', label: 'Secar a la sombra' }
    ]
  });
  const cuello = await findOrCreateAttribute({
    key: 'tipo_cuello', label: 'Tipo de cuello', type: 'select', filterable: true, orden: 4,
    options: [{ value: 'redondo', label: 'Redondo' }, { value: 'v', label: 'En V' }, { value: 'polo', label: 'Polo' }]
  });
  const manga = await findOrCreateAttribute({
    key: 'tipo_manga', label: 'Tipo de manga', type: 'select', filterable: true, orden: 5,
    options: [{ value: 'corta', label: 'Corta' }, { value: 'larga', label: 'Larga' }, { value: 'tres_cuartos', label: '3/4' }]
  });
  const altaVis = await findOrCreateAttribute({ key: 'alta_visibilidad', label: 'Alta visibilidad', type: 'boolean', filterable: true, group: 'Seguridad' });
  const reflejante = await findOrCreateAttribute({ key: 'cinta_reflejante', label: 'Cinta reflejante', type: 'boolean', filterable: true, group: 'Seguridad' });
  const uv = await findOrCreateAttribute({ key: 'proteccion_uv', label: 'Protección UV', type: 'boolean', filterable: true, group: 'Seguridad' });
  console.log('AttributeDefinitions: material, gramaje, cuidados, tipo_cuello, tipo_manga, alta_visibilidad, cinta_reflejante, proteccion_uv');

  // 4) Asignación por categoría (required:false)
  console.log('\nAsignando atributos a categorías:');
  await assignToCategory('playeras', [material, gramaje, cuidados, cuello, manga]);
  await assignToCategory('camisas', [material, gramaje, cuidados, cuello, manga]);
  await assignToCategory('blusas', [material, gramaje, cuidados, cuello, manga]);
  await assignToCategory('chamarras', [material, gramaje, cuidados]);
  await assignToCategory('chalecos', [material, gramaje, cuidados]);
  await assignToCategory('sudaderas', [material, gramaje, cuidados]);
  await assignToCategory('pantalones', [material, gramaje, cuidados]);
  await assignToCategory('rompevientos', [material, gramaje, cuidados]);
  await assignToCategory('linea-cocina', [material, gramaje, cuidados]);
  await assignToCategory('seguridad', [material, gramaje, altaVis, reflejante, uv]);

  await mongoose.disconnect();
  console.log('\nSeed completo.');
}

run().catch((e) => { console.error('Error en seed:', e); process.exit(1); });
