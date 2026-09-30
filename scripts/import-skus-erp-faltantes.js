/**
 * SKUs del ERP que faltaban en la API (Productos.xls, grupos 1 y 2 aprobados
 * por el usuario el 23-09-2026) + quitar SKUs basura (SSDSDS).
 * El plan viene de data/skus-erp-faltantes.json:
 *   productos[].link   -> agregar skusErp a una variante que ya existe (por valores de opción)
 *   productos[].create -> crear la variante (copia los campos de una hermana del mismo color)
 *   quitar[]           -> quitar un skusErp de una variante
 * Los ejes se resuelven por nombre de opción (Color, Talla, Cintura), así sirve para pantalones.
 *
 *   node scripts/import-skus-erp-faltantes.js                       # DRY-RUN (no escribe)
 *   node scripts/import-skus-erp-faltantes.js --write               # respalda y aplica
 *   node scripts/import-skus-erp-faltantes.js --rollback <archivo>  # deshace desde un respaldo
 *
 * Idempotente: si la variante ya existe (corrida previa) solo une los SKUs que falten.
 * Se detiene ante cualquier inconsistencia antes de escribir.
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
const Option = require('../src/models/option.model');
const OptionValue = require('../src/models/optionValue.model');
const { validateProductDynamic } = require('../src/services/productValidation.service');

const { ObjectId } = mongoose.Types;
const { EJSON } = mongoose.mongo.BSON;
const WRITE = process.argv.includes('--write');
const rbIdx = process.argv.indexOf('--rollback');
const ROLLBACK = rbIdx > -1 ? process.argv[rbIdx + 1] : null;
const planIdx = process.argv.indexOf('--plan'); // otro plan con el mismo formato (ej. data/skus-erp-cuello-redondo.json)
const PLAN = planIdx > -1 ? path.resolve(process.argv[planIdx + 1]) : path.join(__dirname, '../data/skus-erp-faltantes.json');
const BACKUP_DIR = path.join(__dirname, '../data/backups');
// Únicos valores de opción que el plan puede crear (los demás deben existir)
const VALORES_PERMITIDOS = [{ opcion: 'Cintura', valor: '48', orden: 48 }];

const up = (s) => String(s).trim().toUpperCase();
const slug = (s) => slugify(String(s), { lower: true, strict: true, trim: true });
const comboKey = (ids) => ids.map(String).sort().join('|');
const fail = (msg) => { console.error('\n✗ ' + msg); process.exitCode = 1; };

async function rollback() {
  const b = EJSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
  console.log(`\n=== ROLLBACK desde ${path.basename(ROLLBACK)} ===`);
  for (const d of b.productosModificados) await Product.collection.replaceOne({ _id: d._id }, d);
  console.log(`Productos restaurados: ${b.productosModificados.length}`);
  if (b.valoresCreados.length) {
    const usados = await Product.countDocuments({ $or: [{ 'options.values': { $in: b.valoresCreados } }, { 'variants.optionValues': { $in: b.valoresCreados } }] });
    if (usados) console.log(`⚠ ${usados} producto(s) aún usan valores creados; no se eliminan.`);
    else console.log(`Valores de opción eliminados: ${(await OptionValue.deleteMany({ _id: { $in: b.valoresCreados } })).deletedCount}`);
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  if (ROLLBACK) return rollback();
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  console.log(`\n=== SKUs FALTANTES — ${WRITE ? 'ESCRITURA' : 'DRY-RUN'} ===\n${plan.fuente}\n`);
  const problemas = [];

  // ---- Opciones y valores ----
  const opciones = await Option.find().lean();
  const optByName = new Map(opciones.map((o) => [o.nombre, o._id]));
  const valores = await OptionValue.find().lean();
  const valByKey = new Map(valores.map((v) => [`${v.option}:${slug(v.valor)}`, v]));
  const ordenVal = new Map(valores.map((v) => [String(v._id), v.orden || 0]));
  const valNuevos = new Map();
  const resolver = (opcion, valor) => {
    const opt = optByName.get(opcion);
    if (!opt) { problemas.push(`Opción no existe: ${opcion}`); return null; }
    const k = `${opt}:${slug(valor)}`;
    if (valByKey.has(k)) return valByKey.get(k)._id;
    if (valNuevos.has(k)) return valNuevos.get(k)._id;
    const perm = VALORES_PERMITIDOS.find((x) => x.opcion === opcion && x.valor === String(valor));
    if (!perm) { problemas.push(`Valor no existe y no está permitido crearlo: ${opcion} ${valor}`); return null; }
    const nv = { _id: new ObjectId(), option: opt, valor: String(valor), slug: slug(valor), orden: perm.orden, activo: true };
    valNuevos.set(k, nv); ordenVal.set(String(nv._id), perm.orden);
    return nv._id;
  };
  const idsDe = (vals) => Object.entries(vals).map(([o, v]) => resolver(o, v));

  // ---- Productos: estado actual -> final ----
  const ids = [...new Set([...plan.productos.map((p) => p.productId), ...plan.quitar.map((q) => q.productId)])];
  const actuales = new Map((await Product.find({ _id: { $in: ids.map((x) => new ObjectId(x)) } }).lean()).map((p) => [String(p._id), p]));
  const trabajo = new Map(); // productId -> { p, vfinal, push, addVals, cambiadas:Set }
  const w = (id, nombre) => {
    if (trabajo.has(id)) return trabajo.get(id);
    const p = actuales.get(id);
    if (!p) { problemas.push(`Producto no existe: ${nombre}`); return null; }
    if (p.nombre !== nombre) { problemas.push(`Nombre cambió: "${nombre}" -> "${p.nombre}"`); return null; }
    const t = { p, vfinal: p.variants.map((v) => ({ ...v, skusErp: (v.skusErp || []).map((x) => ({ sku: x.sku, sexo: x.sexo })) })), push: [], addVals: new Map(), cambiadas: new Set() };
    trabajo.set(id, t);
    return t;
  };
  let nLinks = 0, nCreadas = 0, nSkusCreadas = 0, nQuitados = 0;
  const merge = (v, nuevos) => {
    const have = new Set(v.skusErp.map((x) => up(x.sku)));
    let n = 0;
    for (const x of nuevos) if (!have.has(up(x.sku))) { v.skusErp.push({ sku: up(x.sku), sexo: x.sexo }); have.add(up(x.sku)); n++; }
    return n;
  };
  const detalle = [];
  for (const e of plan.productos) {
    const t = w(e.productId, e.nombre); if (!t) continue;
    const porCombo = () => new Map(t.vfinal.concat(t.push).map((v) => [comboKey(v.optionValues), v]));
    for (const l of e.link) {
      const ov = idsDe(l.valores); if (ov.some((x) => !x)) continue;
      const v = porCombo().get(comboKey(ov));
      if (!v) { problemas.push(`${e.nombre}: no existe la variante ${Object.values(l.valores).join('/')}`); continue; }
      const n = merge(v, l.skusErp); nLinks += n; if (n) t.cambiadas.add(String(v._id));
    }
    for (const c of e.create) {
      const ov = idsDe(c.valores); if (ov.some((x) => !x)) continue;
      const ya = porCombo().get(comboKey(ov));
      if (ya) { const n = merge(ya, c.skusErp); if (t.push.includes(ya)) nSkusCreadas += n; else { nLinks += n; if (n) t.cambiadas.add(String(ya._id)); } continue; }
      // hermana: misma color, la de mayor orden en el otro eje (ej. 3XG) -> se copian sus campos (composición, etc.)
      const colorId = String(ov[Object.keys(c.valores).indexOf('Color')]);
      const hermanas = t.vfinal.filter((v) => v.optionValues.map(String).includes(colorId));
      if (!hermanas.length) { problemas.push(`${e.nombre}: no hay variante hermana ${c.valores.Color} para copiar campos`); continue; }
      const her = hermanas.sort((a, b) => Math.max(...b.optionValues.map((x) => ordenVal.get(String(x)) || 0)) - Math.max(...a.optionValues.map((x) => ordenVal.get(String(x)) || 0)))[0];
      const ejeTalla = Object.keys(c.valores).find((k) => k !== 'Color');
      const tallaHer = (valores.find((v) => her.optionValues.map(String).includes(String(v._id)) && String(v.option) === String(optByName.get(ejeTalla))) || {}).valor;
      const sufijo = '-' + up(slug(tallaHer || ''));
      let sku = tallaHer && up(her.sku).endsWith(sufijo) ? up(her.sku).slice(0, -sufijo.length) + '-' + up(slug(c.valores[ejeTalla])) : [t.p.sku, slug(c.valores.Color), slug(c.valores[ejeTalla])].join('-').toUpperCase();
      const usados = new Set(t.vfinal.concat(t.push).map((v) => up(v.sku)));
      let n = 2; const base = sku; while (usados.has(sku)) sku = `${base}-${n++}`;
      const { _id, sku: _s, optionValues: _o, skusErp: _e, media: _m, stock: _st, ...resto } = her;
      const nv = { ...resto, _id: new ObjectId(), sku, optionValues: ov, skusErp: [], stock: 0, activo: true, media: [] };
      nSkusCreadas += merge(nv, c.skusErp);
      t.push.push(nv); nCreadas++;
      detalle.push(`  + ${e.nombre}: ${sku} (copia de ${her.sku}${Object.keys(resto).length ? '; campos: ' + Object.keys(resto).join(', ') : ''})`);
      // declarar el valor en options si el producto aún no lo tiene
      for (const [opcion, id] of Object.entries(c.valores).map(([o], i) => [o, ov[i]])) {
        const eje = (t.p.options || []).find((o) => String(o.option) === String(optByName.get(opcion)));
        if (!eje) { problemas.push(`${e.nombre}: no tiene el eje ${opcion}`); continue; }
        if (!eje.values.map(String).includes(String(id))) t.addVals.set(String(id), optByName.get(opcion));
      }
    }
  }
  for (const q of plan.quitar) {
    const t = w(q.productId, q.nombre); if (!t) continue;
    const v = t.vfinal.find((x) => x.sku === q.variantSku);
    if (!v) { problemas.push(`${q.nombre}: no existe la variante ${q.variantSku}`); continue; }
    const antes = v.skusErp.length;
    v.skusErp = v.skusErp.filter((x) => up(x.sku) !== up(q.sku));
    if (v.skusErp.length !== antes) { nQuitados++; t.cambiadas.add(String(v._id)); }
  }

  // ---- Comprobaciones: estructura, unicidad global ----
  const destino = new Map();
  for (const t of trabajo.values()) {
    const decl = new Map((t.p.options || []).map((o) => [String(o.option), new Set([...o.values.map(String), ...[...t.addVals].filter(([, opt]) => String(opt) === String(o.option)).map(([id]) => id)])]));
    const combos = new Set(), skus = new Set();
    for (const v of t.vfinal.concat(t.push)) {
      const ejes = new Set();
      for (const ov of v.optionValues.map(String)) {
        const d = [...decl].find(([, s]) => s.has(ov));
        if (!d) problemas.push(`${t.p.nombre}: ${v.sku} usa un valor no declarado`); else ejes.add(d[0]);
      }
      if (decl.size && ejes.size !== decl.size) problemas.push(`${t.p.nombre}: ${v.sku} no tiene un valor por eje`);
      const k = comboKey(v.optionValues); if (combos.has(k)) problemas.push(`${t.p.nombre}: combinación repetida ${v.sku}`); combos.add(k);
      if (skus.has(up(v.sku))) problemas.push(`${t.p.nombre}: SKU interno repetido ${v.sku}`); skus.add(up(v.sku));
      for (const x of v.skusErp) { const s = up(x.sku); if (destino.has(s) && destino.get(s) !== String(v._id)) problemas.push(`SKU ${s} en 2 variantes`); destino.set(s, String(v._id)); }
    }
  }
  const otros = await Product.find({ _id: { $nin: [...trabajo.keys()].map((x) => new ObjectId(x)) }, 'variants.skusErp.sku': { $in: plan.allSkus } }).select('nombre').lean();
  for (const o of otros) problemas.push(`Algún SKU del plan ya existe en otro producto: ${o.nombre}`);
  const sinDestino = plan.allSkus.filter((s) => !destino.has(up(s)));
  if (sinDestino.length) problemas.push(`${sinDestino.length} SKU(s) del plan sin destino: ${sinDestino.slice(0, 10).join(', ')}`);

  if (problemas.length) { [...new Set(problemas)].slice(0, 40).forEach((x) => console.error('  ✗ ' + x)); return fail(`${new Set(problemas).size} problema(s). No se escribió nada.`); }

  console.log('Pre-vuelo OK: estructura válida, SKUs únicos, todos los SKUs del plan tienen destino.\n');
  for (const t of trabajo.values()) {
    const add = t.push.length, sk = t.push.reduce((s, v) => s + v.skusErp.length, 0);
    console.log(`${t.p.nombre}: variantes ${t.p.variants.length} -> ${t.p.variants.length + add} | variantes existentes con SKUs cambiados ${t.cambiadas.size} | SKUs en variantes nuevas ${sk}`);
  }
  console.log(`\nValores de opción a crear: ${[...valNuevos.values()].map((v) => v.valor).join(', ') || '(ninguno)'}`);
  console.log(`SKUs vinculados a variantes existentes: ${nLinks} | variantes nuevas: ${nCreadas} (${nSkusCreadas} SKUs) | SKUs quitados: ${nQuitados} | SKUs del plan: ${plan.allSkus.length}`);
  console.log('\nVariantes nuevas:\n' + detalle.join('\n'));
  if (!WRITE) { console.log('\n⚠  DRY-RUN: no se escribió nada. Corre con --write para aplicar (respalda antes).'); return; }

  // ============================== ESCRITURA ==============================
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const bfile = path.join(BACKUP_DIR, `skus-erp-faltantes-antes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const backup = { fecha: new Date().toISOString(), productosModificados: await Product.collection.find({ _id: { $in: [...trabajo.keys()].map((x) => new ObjectId(x)) } }).toArray(), valoresCreados: [] };
  const guardar = () => fs.writeFileSync(bfile, EJSON.stringify(backup, { relaxed: false }, 1));
  guardar();
  console.log(`\nRespaldo: ${path.relative(path.join(__dirname, '..'), bfile)} (${backup.productosModificados.length} productos)`);
  if (valNuevos.size) {
    await OptionValue.insertMany([...valNuevos.values()]);
    backup.valoresCreados = [...valNuevos.values()].map((v) => v._id); guardar();
    console.log(`Valores de opción creados: ${valNuevos.size}`);
  }
  const bloqueantes = [];
  for (const t of trabajo.values()) {
    const options = (t.p.options || []).map((o) => ({ option: o.option, values: [...o.values, ...[...t.addVals].filter(([, opt]) => String(opt) === String(o.option)).map(([id]) => new ObjectId(id))] }));
    t.optionsFinal = options;
    try { await validateProductDynamic({ ...t.p, options, variants: t.vfinal.concat(t.push) }, { partial: false }); }
    catch (e) { for (const [k, m] of Object.entries(e.details || {})) if (/^(variants|options)/.test(k)) bloqueantes.push(`${t.p.nombre}: ${k}: ${m}`); if (!e.details) bloqueantes.push(`${t.p.nombre}: ${e.message}`); }
  }
  if (bloqueantes.length) { bloqueantes.slice(0, 20).forEach((x) => console.error('  ✗ ' + x)); return fail('El validador de la API rechazó el estado final. Solo se crearon valores de opción; usa --rollback para retirarlos.'); }
  console.log('Validador de la API: OK.');

  const ops = [];
  for (const t of trabajo.values()) {
    const upd = {}; const af = [];
    if (t.push.length) upd.$push = { variants: { $each: t.push } };
    const porOpt = new Map();
    for (const [id, opt] of t.addVals) { if (!porOpt.has(String(opt))) porOpt.set(String(opt), []); porOpt.get(String(opt)).push(new ObjectId(id)); }
    if (porOpt.size) {
      upd.$addToSet = {};
      [...porOpt].forEach(([opt, vals], i) => { upd.$addToSet[`options.$[o${i}].values`] = { $each: vals }; af.push({ [`o${i}.option`]: new ObjectId(opt) }); });
    }
    if (Object.keys(upd).length) ops.push({ updateOne: { filter: { _id: t.p._id }, update: upd, ...(af.length ? { arrayFilters: af } : {}) } });
    for (const v of t.vfinal) if (t.cambiadas.has(String(v._id))) ops.push({ updateOne: { filter: { _id: t.p._id }, update: { $set: { 'variants.$[v].skusErp': v.skusErp } }, arrayFilters: [{ 'v._id': v._id }] } });
  }
  const r = await Product.bulkWrite(ops, { ordered: true });
  console.log(`Operaciones: ${ops.length} (modificadas ${r.modifiedCount})`);

  // ---- Verificación ----
  const all = await Product.find().select('nombre variants._id variants.skusErp').lean();
  const cod = new Map(); let dup = 0;
  for (const p of all) for (const v of p.variants) for (const x of v.skusErp || []) { if (cod.has(up(x.sku))) dup++; cod.set(up(x.sku), p.nombre); }
  const faltan = plan.allSkus.filter((s) => !cod.has(up(s)));
  const siguen = plan.quitar.filter((q) => cod.has(up(q.sku)));
  const vars = (await Product.find({ _id: { $in: [...trabajo.keys()].map((x) => new ObjectId(x)) } }).select('variants._id').lean()).reduce((s, p) => s + p.variants.length, 0);
  const esperadas = [...trabajo.values()].reduce((s, t) => s + t.p.variants.length + t.push.length, 0);
  console.log(`\nVerificación: ${plan.allSkus.length - faltan.length}/${plan.allSkus.length} SKUs del plan en la API · ${dup} repetidos · quitados que siguen: ${siguen.length} · variantes ${vars} (esperado ${esperadas})`);
  if (faltan.length || dup || siguen.length || vars !== esperadas) fail('Hay diferencias tras escribir; revisa o usa --rollback con el respaldo.');
  else console.log('✓ Carga verificada.');
}

run().catch((e) => { console.error('Error:', e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
