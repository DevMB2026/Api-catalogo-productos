const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const Brand = require('../models/brand.model');
const Option = require('../models/option.model');
const OptionValue = require('../models/optionValue.model');
const Feature = require('../models/feature.model');
const Application = require('../models/application.model');
const SizeChart = require('../models/sizeChart.model');
const { resolveAttributeSchema } = require('./attributeSchema.service');

const isId = (v) => mongoose.isValidObjectId(v);

// Valida un valor de atributo contra su definición (tipo + validation).
function validateAttributeValue(def, value, addErr, keyPath) {
  switch (def.type) {
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) return addErr(keyPath, `${def.label} debe ser numérico`);
      const v = def.validation || {};
      if (v.min != null && value < v.min) addErr(keyPath, `${def.label} debe ser ≥ ${v.min}`);
      if (v.max != null && value > v.max) addErr(keyPath, `${def.label} debe ser ≤ ${v.max}`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') addErr(keyPath, `${def.label} debe ser verdadero o falso`);
      break;
    case 'text': {
      if (typeof value !== 'string') return addErr(keyPath, `${def.label} debe ser texto`);
      const v = def.validation || {};
      if (v.maxLength != null && value.length > v.maxLength) addErr(keyPath, `${def.label} excede ${v.maxLength} caracteres`);
      if (v.regex) { try { if (!new RegExp(v.regex).test(value)) addErr(keyPath, `${def.label} no cumple el formato`); } catch { /* regex inválida en la def, se ignora */ } }
      break;
    }
    case 'select': {
      const allowed = (def.options || []).map((o) => o.value);
      if (!allowed.includes(value)) addErr(keyPath, `${def.label}: valor no permitido`);
      break;
    }
    case 'multiselect': {
      if (!Array.isArray(value)) return addErr(keyPath, `${def.label} debe ser una lista`);
      const allowed = (def.options || []).map((o) => o.value);
      for (const item of value) if (!allowed.includes(item)) addErr(keyPath, `${def.label}: contiene un valor no permitido (${item})`);
      break;
    }
    default:
      break;
  }
}

// Validación semántica de un Product (después de que Zod validó la FORMA).
// `partial` = true en PATCH: no exige atributos requeridos (edición parcial).
// Lanza AppError(400, VALIDATION_ERROR, ..., fields) si hay problemas.
async function validateProductDynamic(body, { partial = false } = {}) {
  const fields = {};
  const addErr = (k, msg) => { if (!fields[k]) fields[k] = msg; };

  // --- Categoría (necesaria para el esquema) + marca ---
  let schema = null;
  if (body.category != null) {
    if (!isId(body.category)) addErr('category', 'Categoría inválida');
    else {
      try { schema = await resolveAttributeSchema(body.category); }
      catch { addErr('category', 'La categoría no existe'); }
    }
  } else if (!partial) {
    addErr('category', 'La categoría es obligatoria');
  }
  if (body.brand != null && isId(body.brand)) {
    const b = await Brand.findById(body.brand).select('_id');
    if (!b) addErr('brand', 'La marca no existe');
  }
  if (Array.isArray(body.brands) && body.brands.length) {
    const ids = body.brands.filter(isId);
    const found = await Brand.countDocuments({ _id: { $in: ids } });
    if (found !== body.brands.length) addErr('brands', 'Alguna marca de la lista no existe');
  }

  // --- Atributos (EAV) contra el esquema de la categoría ---
  if (schema && body.attributes != null) {
    const allowed = new Map(schema.attributes.map((a) => [String(a.def._id), a]));
    const seen = new Set();
    for (const item of body.attributes) {
      const aid = String(item.attribute);
      const entry = allowed.get(aid);
      if (!entry) { addErr('attributes', `Hay un atributo no permitido en la categoría "${schema.category.nombre}"`); continue; }
      seen.add(aid);
      validateAttributeValue(entry.def, item.value, addErr, `attributes.${entry.def.key}`);
    }
    if (!partial) {
      for (const a of schema.attributes) {
        if (a.required && !seen.has(String(a.def._id))) addErr(`attributes.${a.def.key}`, `${a.def.label} es obligatorio`);
      }
    }
  }

  // --- Options (ejes declarados + valores disponibles) ---
  const optionValueOwner = new Map(); // optionValueId -> optionId
  const declaredOptions = new Set();
  if (body.options != null) {
    const optIds = body.options.map((o) => o.option).filter(isId);
    const valIds = body.options.flatMap((o) => o.values || []).filter(isId);
    const [opts, vals] = await Promise.all([
      Option.find({ _id: { $in: optIds } }).select('_id'),
      OptionValue.find({ _id: { $in: valIds } }).select('_id option')
    ]);
    const optSet = new Set(opts.map((o) => String(o._id)));
    const valById = new Map(vals.map((v) => [String(v._id), v]));
    for (const o of body.options) {
      if (!optSet.has(String(o.option))) { addErr('options', 'Una opción declarada no existe'); continue; }
      declaredOptions.add(String(o.option));
      for (const vid of o.values || []) {
        const v = valById.get(String(vid));
        if (!v) { addErr('options', 'Un valor de opción no existe'); continue; }
        if (String(v.option) !== String(o.option)) { addErr('options', 'Un valor no pertenece a su opción'); continue; }
        optionValueOwner.set(String(vid), String(o.option));
      }
    }
  }

  // --- Variants (combinaciones) ---
  if (body.variants != null) {
    const skus = new Set();
    const combos = new Set();
    body.variants.forEach((v, i) => {
      if (!partial && (!v.sku || !String(v.sku).trim())) addErr(`variants.${i}.sku`, 'La variante requiere SKU');
      if (v.sku) {
        const s = String(v.sku).toUpperCase();
        if (skus.has(s)) addErr(`variants.${i}.sku`, 'SKU de variante duplicado');
        skus.add(s);
      }
      const ovs = (v.optionValues || []).map(String);
      const coveredOptions = new Set();
      for (const ov of ovs) {
        const optId = optionValueOwner.get(ov);
        if (!optId) { addErr(`variants.${i}.optionValues`, 'Un valor de la variante no está entre los declarados en options'); continue; }
        if (coveredOptions.has(optId)) addErr(`variants.${i}.optionValues`, 'La variante repite un eje (dos valores del mismo Option)');
        coveredOptions.add(optId);
      }
      if (declaredOptions.size > 0 && coveredOptions.size !== declaredOptions.size) {
        addErr(`variants.${i}.optionValues`, 'La variante debe tener exactamente un valor por cada eje declarado');
      }
      const comboKey = [...ovs].sort().join('|');
      if (comboKey) {
        if (combos.has(comboKey)) addErr(`variants.${i}`, 'Combinación de variante duplicada');
        combos.add(comboKey);
      }
    });
  }

  // --- Existencia de refs: features / applications / sizeChart ---
  if (body.features && body.features.length) {
    const found = await Feature.countDocuments({ _id: { $in: body.features.filter(isId) } });
    if (found !== body.features.length) addErr('features', 'Alguna característica no existe');
  }
  if (body.applications && body.applications.length) {
    const found = await Application.countDocuments({ _id: { $in: body.applications.filter(isId) } });
    if (found !== body.applications.length) addErr('applications', 'Alguna aplicación no existe');
  }
  if (body.sizeChart != null && isId(body.sizeChart)) {
    const sc = await SizeChart.findById(body.sizeChart).select('_id');
    if (!sc) addErr('sizeChart', 'La tabla de medidas no existe');
  }

  if (Object.keys(fields).length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Datos inválidos', fields);
  }
}

module.exports = { validateProductDynamic };
