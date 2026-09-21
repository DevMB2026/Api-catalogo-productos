/**
 * CARGA TOTAL de los SKUs del ERP (PRODUCTOS 2026.xlsx). Continúa a
 * import-skus-erp.js: además de vincular a variantes existentes, CREA lo que
 * falta para que TODOS los SKUs queden en la API:
 *   - valores de opción nuevos (tallas 4XG/5XG, algunos colores),
 *   - variantes nuevas (color+talla) en productos existentes,
 *   - productos nuevos como BORRADOR (activo=false, sin fotos),
 *   - conversión de un producto solo-color a color+talla (Chamarra Hydro).
 * El plan (qué vincular / qué crear) viene revisado en data/skus-erp-carga-total.json.
 *
 *   node scripts/import-skus-erp-total.js                       # DRY-RUN (no escribe)
 *   node scripts/import-skus-erp-total.js --write               # respalda y aplica
 *   node scripts/import-skus-erp-total.js --rollback <archivo>  # deshace desde un respaldo
 *
 * Idempotente: si una variante/producto ya existe (corrida previa) solo une los
 * SKUs que falten. Se detiene ante cualquier inconsistencia antes de escribir.
 */
const path = require('path');
const fs = require('fs');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const slugify = require('slugify');
fs.readdirSync(path.join(__dirname, '../src/models')).forEach((f) => require(path.join(__dirname, '../src/models', f)));
const Product = require('../src/models/product.model');
const OptionValue = require('../src/models/optionValue.model');
const Category = require('../src/models/category.model');
const Brand = require('../src/models/brand.model');
const { validateProductDynamic } = require('../src/services/productValidation.service');
const { generateUniqueSlug } = require('../src/utils/slug');

const { ObjectId } = mongoose.Types;
const { EJSON } = mongoose.mongo.BSON;
const WRITE = process.argv.includes('--write');
const rbIdx = process.argv.indexOf('--rollback');
const ROLLBACK = rbIdx > -1 ? process.argv[rbIdx + 1] : null;
const PLAN = path.join(__dirname, '../data/skus-erp-carga-total.json');
const BACKUP_DIR = path.join(__dirname, '../data/backups');

const up = (s) => String(s).toUpperCase();
const slug = (s) => slugify(String(s), { lower: true, strict: true, trim: true });
const comboKey = (ids) => ids.map(String).sort().join('|');
const fail = (msg) => { console.error('\n✗ ' + msg); process.exitCode = 1; };

// ============================== ROLLBACK ==============================
async function rollback() {
  const b = EJSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
  console.log(`\n=== ROLLBACK desde ${path.basename(ROLLBACK)} ===`);
  for (const d of b.productosModificados) await Product.collection.replaceOne({ _id: d._id }, d);
  console.log(`Productos restaurados a su estado previo: ${b.productosModificados.length}`);
  if (b.productosCreados.length) {
    const r = await Product.deleteMany({ _id: { $in: b.productosCreados } });
    console.log(`Productos nuevos eliminados: ${r.deletedCount}`);
  }
  if (b.valoresCreados.length) {
    const usados = await Product.countDocuments({ $or: [{ 'options.values': { $in: b.valoresCreados } }, { 'variants.optionValues': { $in: b.valoresCreados } }] });
    if (usados) console.log(`⚠ ${usados} producto(s) aún usan valores de opción creados; no se eliminan.`);
    else console.log(`Valores de opción eliminados: ${(await OptionValue.deleteMany({ _id: { $in: b.valoresCreados } })).deletedCount}`);
  }
}

// ============================== PLAN → ESTADO FINAL ==============================
async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  if (ROLLBACK) return rollback();

  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  console.log(`\n=== CARGA TOTAL SKUs ERP — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===\n${plan.fuente}\n`);
  const problemas = [];
  const optColor = new ObjectId(plan.optionIds.color);
  const optTalla = new ObjectId(plan.optionIds.talla);

  // ---- 1) Valores de opción: existentes vs. por crear ----
  const ovDb = await OptionValue.find({ option: { $in: [optColor, optTalla] } }).lean();
  const ovById = new Map(ovDb.map((v) => [String(v._id), v]));
  const ovBySlug = new Map(ovDb.map((v) => [`${String(v.option)}:${v.slug}`, v]));
  const ovNuevos = new Map(); // `${optId}:${slug}` -> { _id, option, valor, slug, meta, orden }
  const maxOrdenColor = Math.max(0, ...ovDb.filter((v) => String(v.option) === String(optColor)).map((v) => v.orden || 0));
  let ordenColor = maxOrdenColor;
  for (const n of plan.optionValuesToCreate) {
    const opt = n.option === 'color' ? optColor : optTalla;
    const key = `${opt}:${slug(n.valor)}`;
    if (ovBySlug.has(key)) continue; // ya existe (corrida previa)
    ovNuevos.set(key, { _id: new ObjectId(), option: opt, valor: n.valor, slug: slug(n.valor), meta: n.meta, orden: n.orden != null ? n.orden : ++ordenColor, activo: true });
  }
  const resolve = (optSlug, ref) => {
    if (!ref) return null;
    const opt = optSlug === 'color' ? optColor : optTalla;
    if (ref.id) {
      if (!ovById.has(ref.id)) { problemas.push(`Valor de opción no existe: ${optSlug} ${ref.valor} (${ref.id})`); return null; }
      return new ObjectId(ref.id);
    }
    const key = `${opt}:${slug(ref.valor)}`;
    const found = ovBySlug.get(key) || ovNuevos.get(key);
    if (!found) { problemas.push(`Valor de opción sin resolver: ${optSlug} ${ref.valor}`); return null; }
    return found._id;
  };

  // ---- 2) Productos existentes: estado actual → estado final ----
  const ids = plan.existingProducts.map((e) => new ObjectId(e.productId));
  const actuales = await Product.find({ _id: { $in: ids } }).lean();
  const actById = new Map(actuales.map((p) => [String(p._id), p]));
  const trabajo = []; // { e, p, ops-info, final }
  let nVarNuevas = 0, nSkusNuevos = 0, nLinks = 0;
  for (const e of plan.existingProducts) {
    const p = actById.get(e.productId);
    if (!p) { problemas.push(`Producto no existe: ${e.nombre}`); continue; }
    if (p.nombre !== e.nombre) { problemas.push(`Nombre cambió: "${e.nombre}" -> "${p.nombre}"`); continue; }
    const w = { e, p, links: [], push: [], addColor: [], addTalla: [], convert: !!e.convertToSized, optionsFinal: null, variantsFinal: null, skuUsados: new Set() };
    const eje = (o) => (p.options || []).find((x) => String(x.option) === String(o));
    if (w.convert && eje(optTalla)) { problemas.push(`${p.nombre}: se pidió convertir pero ya tiene eje talla`); continue; }
    if (!w.convert && (e.create || []).some((c) => c.talla) && !eje(optTalla)) { problemas.push(`${p.nombre}: tiene tallas nuevas pero no eje talla (falta convertToSized)`); continue; }
    const baseVars = w.convert ? [] : p.variants;              // al convertir se reemplazan las variantes actuales
    const porCombo = new Map(baseVars.map((v) => [comboKey(v.optionValues), v]));
    const porId = new Map(p.variants.map((v) => [String(v._id), v]));
    const skusVar = new Set(baseVars.map((v) => up(v.sku || '')));
    const colorVals = new Set(((eje(optColor) || {}).values || []).map(String));
    const tallaVals = new Set(w.convert ? [] : ((eje(optTalla) || {}).values || []).map(String));
    const linkMap = new Map(); // variantId -> skusErp finales
    const vfinal = w.convert ? [] : p.variants.map((v) => ({ ...v, skusErp: (v.skusErp || []).map((x) => ({ sku: x.sku, sexo: x.sexo })) }));
    const vfinalById = new Map(vfinal.map((v) => [String(v._id), v]));
    const merge = (v, nuevos) => {
      const have = new Set(v.skusErp.map((x) => up(x.sku)));
      for (const x of nuevos) if (!have.has(up(x.sku))) { v.skusErp.push({ sku: up(x.sku), sexo: x.sexo }); have.add(up(x.sku)); nSkusNuevos++; }
    };
    // 2a) vincular a variantes existentes
    for (const l of e.link || []) {
      // se busca la variante por color+talla (no por _id): si alguien editó el producto en el admin los _id cambian
      const ov = [resolve('color', l.color), resolve('talla', l.talla)].filter(Boolean);
      const v0 = porCombo.get(comboKey(ov));
      const v = v0 && vfinalById.get(String(v0._id));
      if (!v) { problemas.push(`${p.nombre}: no existe la variante ${l.color ? l.color.valor : ''}/${l.talla ? l.talla.valor : 'unitalla'}`); continue; }
      merge(v, l.skusErp); nLinks += l.skusErp.length;
    }
    // 2b) crear variantes (o unir SKUs si ya existen por una corrida previa)
    const nuevas = new Map(); // combo -> variante nueva
    for (const c of e.create || []) {
      const cid = resolve('color', c.color), tid = resolve('talla', c.talla);
      const ov = [cid, tid].filter(Boolean);
      const ck = comboKey(ov);
      const ya = porCombo.get(ck) && vfinalById.get(String(porCombo.get(ck)._id));
      if (ya) { merge(ya, c.skusErp); continue; }
      let nv = nuevas.get(ck);
      if (!nv) {
        let sku = [p.sku, c.color && c.color.valor, c.talla && c.talla.valor].filter(Boolean).map((s, i) => (i === 0 ? String(s) : slug(s))).join('-').toUpperCase();
        let n = 2; const base = sku; while (skusVar.has(sku)) sku = `${base}-${n++}`; skusVar.add(sku);
        nv = { _id: new ObjectId(), sku, optionValues: ov, skusErp: [], stock: 0, activo: true, media: [] };
        nuevas.set(ck, nv); nVarNuevas++;
        if (cid && !colorVals.has(String(cid))) { colorVals.add(String(cid)); w.addColor.push(cid); }
        if (tid && !tallaVals.has(String(tid))) { tallaVals.add(String(tid)); w.addTalla.push(tid); }
      }
      merge(nv, c.skusErp);
    }
    w.push = [...nuevas.values()];
    w.variantsFinal = [...vfinal, ...w.push];
    w.optionsFinal = w.convert
      ? [{ option: optColor, values: [...colorVals].map((x) => new ObjectId(x)) }, { option: optTalla, values: [...tallaVals].map((x) => new ObjectId(x)) }]
      : (p.options || []).map((o) => ({ option: o.option, values: [...o.values, ...(String(o.option) === String(optColor) ? w.addColor : String(o.option) === String(optTalla) ? w.addTalla : [])] }));
    w.linksFinal = vfinal.filter((v) => (e.link || []).some((l) => l.variantId === String(v._id)) || (e.create || []).length);
    trabajo.push(w);
  }

  // ---- 3) Productos nuevos (borradores) ----
  const cats = new Map((await Category.find().lean()).map((c) => [c.nombre, c._id]));
  const brs = new Map((await Brand.find().lean()).map((b) => [b.slug, b._id]));
  const nuevosProd = [];
  for (const np of plan.newProducts) {
    const ya = await Product.findOne({ sku: up(np.sku) }).select('nombre').lean();
    if (ya) { console.log(`  · ${np.nombre}: ya existe (SKU ${np.sku}), se omite su creación.`); continue; }
    if (!cats.has(np.category)) { problemas.push(`Categoría no existe: ${np.category}`); continue; }
    if (!brs.has(np.brand)) { problemas.push(`Marca no existe: ${np.brand}`); continue; }
    const colorVals = new Set(), tallaVals = new Set(), skusVar = new Set(), variants = [];
    for (const v of np.variants) {
      const cid = resolve('color', v.color), tid = resolve('talla', v.talla);
      if (cid) colorVals.add(String(cid)); if (tid) tallaVals.add(String(tid));
      let sku = [np.sku, v.color && v.color.valor, v.talla && v.talla.valor].filter(Boolean).map((s, i) => (i === 0 ? String(s) : slug(s))).join('-').toUpperCase();
      let n = 2; const base = sku; while (skusVar.has(sku)) sku = `${base}-${n++}`; skusVar.add(sku);
      variants.push({ _id: new ObjectId(), sku, optionValues: [cid, tid].filter(Boolean), skusErp: v.skusErp.map((x) => ({ sku: up(x.sku), sexo: x.sexo })), stock: 0, activo: true, media: [] });
      nVarNuevas++; nSkusNuevos += v.skusErp.length;
    }
    const options = [];
    if (colorVals.size) options.push({ option: optColor, values: [...colorVals].map((x) => new ObjectId(x)) });
    if (tallaVals.size) options.push({ option: optTalla, values: [...tallaVals].map((x) => new ObjectId(x)) });
    nuevosProd.push({ np, doc: { nombre: np.nombre, sku: up(np.sku), brand: brs.get(np.brand), brands: [brs.get(np.brand)], category: cats.get(np.category), sexo: np.sexo, activo: false, options, variants } });
  }

  // ---- 4) Comprobaciones estructurales (mismas reglas que la API) ----
  const estructura = (nombre, options, variants) => {
    const decl = new Map(options.map((o) => [String(o.option), new Set(o.values.map(String))]));
    const combos = new Set(), skus = new Set();
    for (const v of variants) {
      const cubiertos = new Set();
      for (const ov of v.optionValues.map(String)) {
        const dueño = [...decl].find(([, s]) => s.has(ov));
        if (!dueño) { problemas.push(`${nombre}: variante ${v.sku} usa un valor no declarado en options`); continue; }
        if (cubiertos.has(dueño[0])) problemas.push(`${nombre}: variante ${v.sku} repite un eje`);
        cubiertos.add(dueño[0]);
      }
      if (decl.size && cubiertos.size !== decl.size) problemas.push(`${nombre}: variante ${v.sku} no tiene un valor por cada eje`);
      const k = comboKey(v.optionValues); if (combos.has(k)) problemas.push(`${nombre}: combinación repetida en ${v.sku}`); combos.add(k);
      if (skus.has(up(v.sku))) problemas.push(`${nombre}: SKU de variante repetido ${v.sku}`); skus.add(up(v.sku));
    }
  };
  for (const w of trabajo) estructura(w.p.nombre, w.optionsFinal, w.variantsFinal);
  for (const n of nuevosProd) estructura(n.np.nombre, n.doc.options, n.doc.variants);

  // ---- 5) Unicidad global de códigos ERP ----
  const destino = new Map(); // código -> variantId final
  const registrar = (v, dueño) => { for (const x of v.skusErp || []) { const k = up(x.sku); if (destino.has(k) && destino.get(k) !== String(v._id)) problemas.push(`SKU ${k} asignado a 2 variantes (${dueño})`); destino.set(k, String(v._id)); } };
  for (const w of trabajo) for (const v of w.variantsFinal) registrar(v, w.p.nombre);
  for (const n of nuevosProd) for (const v of n.doc.variants) registrar(v, n.np.nombre);
  const tocados = new Set(trabajo.map((w) => String(w.p._id)));
  const otros = await Product.find({ _id: { $nin: [...tocados].map((x) => new ObjectId(x)) }, 'variants.skusErp.0': { $exists: true } }).select('nombre variants.skusErp').lean();
  for (const p of otros) for (const v of p.variants) for (const x of v.skusErp || []) if (destino.has(up(x.sku))) problemas.push(`SKU ${x.sku} ya existe en otro producto (${p.nombre})`);
  const faltan = plan.allSkus.filter((s) => !destino.has(up(s)));
  // los códigos ya cargados en la fase anterior deben seguir presentes en su variante
  const prev = await Product.find({ 'variants.skusErp.0': { $exists: true } }).select('variants._id variants.skusErp').lean();
  const enDb = new Set(); for (const p of prev) for (const v of p.variants) for (const x of v.skusErp || []) enDb.add(up(x.sku));
  const sinCubrir = faltan.filter((s) => !enDb.has(up(s)));

  if (problemas.length) { [...new Set(problemas)].slice(0, 40).forEach((x) => console.error('  ✗ ' + x)); return fail(`${new Set(problemas).size} problema(s) en el pre-vuelo. No se escribió nada.`); }
  if (sinCubrir.length) { sinCubrir.slice(0, 20).forEach((s) => console.error('  ✗ SKU sin destino: ' + s)); return fail(`${sinCubrir.length} SKU(s) del Excel sin destino. No se escribió nada.`); }

  // ---- Resumen ----
  console.log('Pre-vuelo OK: estructura válida, SKUs únicos, todos los SKUs del Excel tienen destino.\n');
  console.log(`Valores de opción a crear: ${ovNuevos.size} -> ${[...ovNuevos.values()].map((v) => v.valor).join(', ') || '(ninguno)'}`);
  console.log(`Productos existentes a modificar: ${trabajo.length} (convertir a color+talla: ${trabajo.filter((w) => w.convert).map((w) => w.p.nombre).join(', ') || 'ninguno'})`);
  console.log(`Productos nuevos (borrador): ${nuevosProd.length} -> ${nuevosProd.map((n) => `${n.np.nombre} [${n.doc.variants.length} var.]`).join('; ')}`);
  console.log(`Variantes nuevas: ${nVarNuevas} | SKUs que se agregan a variantes: ${nSkusNuevos} | SKUs únicos del Excel: ${plan.allSkus.length}`);
  const totalAntes = await Product.aggregate([{ $unwind: '$variants' }, { $count: 'n' }]);
  const quitadas = trabajo.filter((w) => w.convert).reduce((s, w) => s + w.p.variants.length, 0);
  const esperadas = (totalAntes[0] ? totalAntes[0].n : 0) + nVarNuevas - quitadas;
  console.log(`Variantes en la API: ${totalAntes[0] ? totalAntes[0].n : 0} -> ${esperadas} (se reemplazan ${quitadas} de Hydro)`);
  if (!WRITE) { console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar (respalda antes).'); return; }

  // ============================== ESCRITURA ==============================
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const bfile = path.join(BACKUP_DIR, `skus-erp-total-antes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const docsAntes = await Product.collection.find({ _id: { $in: trabajo.map((w) => w.p._id) } }).toArray();
  const backup = { fecha: new Date().toISOString(), productosModificados: docsAntes, productosCreados: [], valoresCreados: [] };
  const guardarBackup = () => fs.writeFileSync(bfile, EJSON.stringify(backup, { relaxed: false }, 1));
  guardarBackup();
  console.log(`\nRespaldo: ${path.relative(path.join(__dirname, '..'), bfile)} (${docsAntes.length} productos)`);

  if (ovNuevos.size) {
    await OptionValue.insertMany([...ovNuevos.values()]);
    backup.valoresCreados = [...ovNuevos.values()].map((v) => v._id); guardarBackup();
    console.log(`Valores de opción creados: ${ovNuevos.size}`);
  }
  // Validación con el validador REAL de la API (necesita que los valores ya existan). Solo errores de variantes/opciones bloquean.
  const bloqueantes = [];
  const valida = async (nombre, body) => {
    try { await validateProductDynamic(body, { partial: false }); }
    catch (e) { for (const [k, m] of Object.entries(e.details || {})) if (/^(variants|options)/.test(k)) bloqueantes.push(`${nombre}: ${k}: ${m}`); if (!e.details) bloqueantes.push(`${nombre}: ${e.message}`); }
  };
  for (const w of trabajo) await valida(w.p.nombre, { ...w.p, options: w.optionsFinal, variants: w.variantsFinal });
  for (const n of nuevosProd) await valida(n.np.nombre, { ...n.doc });
  if (bloqueantes.length) { bloqueantes.slice(0, 20).forEach((x) => console.error('  ✗ ' + x)); return fail('El validador de la API rechazó el estado final. Solo se crearon valores de opción; usa --rollback con el respaldo si quieres retirarlos.'); }
  console.log('Validador de la API: OK para todos los productos.');

  const ops = [];
  for (const w of trabajo) {
    if (w.convert) { ops.push({ updateOne: { filter: { _id: w.p._id }, update: { $set: { options: w.optionsFinal, variants: w.variantsFinal } } } }); continue; }
    const upd = {}; const af = [];
    if (w.push.length) upd.$push = { variants: { $each: w.push } };
    const add = {};
    if (w.addColor.length) { add['options.$[c].values'] = { $each: w.addColor }; af.push({ 'c.option': optColor }); }
    if (w.addTalla.length) { add['options.$[t].values'] = { $each: w.addTalla }; af.push({ 't.option': optTalla }); }
    if (Object.keys(add).length) upd.$addToSet = add;
    if (Object.keys(upd).length) ops.push({ updateOne: { filter: { _id: w.p._id }, update: upd, ...(af.length ? { arrayFilters: af } : {}) } });
    for (const v of w.variantsFinal) {
      const antes = w.p.variants.find((x) => String(x._id) === String(v._id));
      if (!antes) continue; // las nuevas ya llevan sus skusErp en el $push
      if ((antes.skusErp || []).length === v.skusErp.length) continue;
      ops.push({ updateOne: { filter: { _id: w.p._id }, update: { $set: { 'variants.$[v].skusErp': v.skusErp } }, arrayFilters: [{ 'v._id': v._id }] } });
    }
  }
  const r = await Product.bulkWrite(ops, { ordered: true });
  console.log(`Productos existentes actualizados: ${r.modifiedCount} operaciones (matched ${r.matchedCount})`);
  for (const n of nuevosProd) {
    const doc = { ...n.doc, slug: await generateUniqueSlug(Product, n.np.nombre) };
    const created = await Product.create(doc);
    backup.productosCreados.push(created._id); guardarBackup();
    console.log(`  + Producto borrador creado: ${created.nombre} (${created.variants.length} variantes)`);
  }

  // ---- Verificación posterior ----
  const all = await Product.find().select('variants.skusErp variants._id').lean();
  const codigos = new Map(); let dup = 0, nvars = 0;
  for (const p of all) for (const v of p.variants) { nvars++; for (const x of v.skusErp || []) { if (codigos.has(up(x.sku))) dup++; codigos.set(up(x.sku), String(v._id)); } }
  const sinDestino = plan.allSkus.filter((s) => !codigos.has(up(s)));
  console.log(`\nVerificación: ${codigos.size} SKUs ERP en la API (esperado ${plan.allSkus.length}) · ${sinDestino.length} del Excel sin cargar · ${dup} repetidos · variantes ${nvars} (esperado ${esperadas})`);
  if (sinDestino.length || dup || nvars !== esperadas) fail('Hay diferencias tras escribir; revisa o usa --rollback con el respaldo.');
  else console.log('✓ Carga total verificada: todos los SKUs del Excel están en la API.');
}

run().catch((e) => { console.error('Error:', e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
