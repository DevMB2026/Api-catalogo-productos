const slugify = require('slugify');
const Product = require('../models/product.model');
const Brand = require('../models/brand.model');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { quitarValoresOcultos } = require('../utils/valoresOcultos');

// Ficha compacta de producto para el chatbot (OpenClaw / Prezi).
//
// Solo lectura y PÚBLICA, igual que GET /products, pero devuelve UN SUBCONJUNTO
// corto y ya "masticado" para que el bot gaste pocos tokens: descripción, tela,
// colores, tallas, tabla de medidas, características y preguntas frecuentes.
//
// Deliberadamente NO incluye: precios, stock, SKUs, imágenes ni valores
// ocultos. Los precios los calcula únicamente la calculadora de cotizaciones.

const MAX_DESC = 600;
const MAX_FAQ = 5;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const recorta = (s, n) => (s && s.length > n ? `${s.slice(0, n).trim()}…` : (s || ''));
const nom = (x) => (x && (x.nombre || x.valor)) || null;

// Valor de un atributo dinámico en texto legible.
function valorAtributo(def, value) {
  if (value === undefined || value === null || value === '') return null;
  const opt = (v) => {
    const o = (def.options || []).find((x) => x.value === v);
    return o ? (o.label || o.value) : v;
  };
  if (def.type === 'boolean') return value ? 'sí' : 'no';
  if (def.type === 'multiselect' && Array.isArray(value)) return value.map(opt).join(', ');
  if (def.type === 'select') return opt(value);
  return def.unit ? `${value} ${def.unit}` : String(value);
}

function tablaMedidas(chart) {
  if (!chart || !chart.rows || chart.rows.length === 0) return null;
  return {
    nombre: chart.nombre,
    unidad: chart.unidad,
    columnas: chart.columns,
    filas: chart.rows.map((r) => {
      const medidas = {};
      (chart.columns || []).forEach((c, i) => { medidas[c] = r.values[i]; });
      return { talla: r.label, medidas };
    })
  };
}

function armarFicha(raw) {
  const p = quitarValoresOcultos(raw); // quita colores/variantes ocultos

  // Ejes: color, talla y cualquier otro (en el pool de opciones del producto).
  let colores = [];
  let tallas = [];
  const otras = [];
  for (const o of p.options || []) {
    const nombreEje = (o.option && o.option.nombre) || '';
    const valores = (o.values || []).map((v) => v.valor).filter(Boolean);
    if (/color/i.test(nombreEje)) colores = valores;
    else if (/talla|size/i.test(nombreEje) || (o.option && o.option.tipo === 'size')) tallas = valores;
    else if (valores.length) otras.push({ opcion: nombreEje, valores });
  }

  const composiciones = [...new Set((p.variants || []).map((v) => (v.composicion || '').trim()).filter(Boolean))];

  const atributos = [];
  for (const a of p.attributes || []) {
    if (!a.attribute || a.attribute.activo === false) continue;
    const v = valorAtributo(a.attribute, a.value);
    if (v !== null) atributos.push({ atributo: a.attribute.label, valor: v });
  }

  const medidas = {
    general: tablaMedidas(p.sizeChart),
    hombre: tablaMedidas(p.sizeChartHombre),
    mujer: tablaMedidas(p.sizeChartMujer)
  };
  const hayMedidas = medidas.general || medidas.hombre || medidas.mujer;

  return {
    nombre: p.nombre,
    marca: nom(p.brand),
    marcas: (p.brands || []).map(nom).filter(Boolean),
    categoria: nom(p.category),
    publico: p.sexo,
    descripcion: recorta(p.descripcion, MAX_DESC),
    composicion: composiciones,
    colores,
    tallas,
    otras_opciones: otras,
    atributos,
    caracteristicas: (p.features || []).map(nom).filter(Boolean),
    personalizaciones: (p.applications || []).map(nom).filter(Boolean),
    tabla_de_medidas: hayMedidas ? medidas : null,
    preguntas_frecuentes: (p.faq || []).slice(0, MAX_FAQ).map((f) => ({ pregunta: f.pregunta, respuesta: f.respuesta }))
  };
}

// Versión en texto plano (más fácil para que la lea el bot).
function aTexto(f) {
  const L = [];
  L.push(`PRODUCTO: ${f.nombre}`);
  L.push(`Marca: ${f.marca || '-'}${f.marcas.length > 1 ? ` (también en: ${f.marcas.join(', ')})` : ''} | Categoría: ${f.categoria || '-'} | Público: ${(f.publico || []).join(', ') || '-'}`);
  if (f.descripcion) L.push(`Descripción: ${f.descripcion}`);
  if (f.composicion.length) L.push(`Composición/tela: ${f.composicion.join(' | ')}`);
  L.push(`Colores: ${f.colores.length ? f.colores.join(', ') : 'sin dato'}`);
  L.push(`Tallas: ${f.tallas.length ? f.tallas.join(', ') : 'sin dato'}`);
  for (const o of f.otras_opciones) L.push(`${o.opcion}: ${o.valores.join(', ')}`);
  for (const a of f.atributos) L.push(`${a.atributo}: ${a.valor}`);
  if (f.caracteristicas.length) L.push(`Características: ${f.caracteristicas.join(', ')}`);
  if (f.personalizaciones.length) L.push(`Personalizaciones disponibles: ${f.personalizaciones.join(', ')}`);
  const m = f.tabla_de_medidas;
  if (m) {
    for (const [quien, t] of Object.entries(m)) {
      if (!t) continue;
      L.push(`Tabla de medidas${quien === 'general' ? '' : ` (${quien})`} [${t.unidad}]: ` + t.filas.map((r) => `${r.talla}: ${Object.entries(r.medidas).map(([c, v]) => `${c} ${v}`).join(', ')}`).join(' ; '));
    }
  } else {
    L.push('Tabla de medidas: sin dato');
  }
  for (const q of f.preguntas_frecuentes) L.push(`P: ${q.pregunta} R: ${q.respuesta}`);
  return L.join('\n');
}

const POPULATE = [
  { path: 'brand', select: 'nombre slug' },
  { path: 'brands', select: 'nombre slug' },
  { path: 'category', select: 'nombre slug' },
  { path: 'attributes.attribute' },
  { path: 'features', select: 'nombre' },
  { path: 'applications', select: 'nombre' },
  { path: 'options.option' },
  { path: 'options.values' },
  { path: 'variants.optionValues', select: 'valor' },
  { path: 'sizeChart' },
  { path: 'sizeChartHombre' },
  { path: 'sizeChartMujer' }
];

// GET /api/v1/bot/ficha?q=polo&marca=be-fresh&limit=3&formato=texto
// También acepta ?sku=XXXX o ?slug=xxxx en vez de q.
exports.ficha = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const sku = String(req.query.sku || '').trim().toUpperCase().slice(0, 60);
  const slug = String(req.query.slug || '').trim().toLowerCase().slice(0, 120);
  if (!q && !sku && !slug) {
    throw new AppError(400, 'MISSING_QUERY', 'Indica q (texto), sku o slug');
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));

  const base = { activo: true };
  if (req.query.marca) {
    const brand = await Brand.findOne({ slug: String(req.query.marca).toLowerCase() }, '_id');
    if (!brand) return respond(req, res, [], false);
    base.brands = brand._id;
  }

  let docs = [];
  let aproximada = false;
  if (sku) {
    docs = await Product.find({ ...base, $or: [{ sku }, { 'skuAliases.sku': sku }] }).limit(limit).populate(POPULATE).lean();
  } else if (slug) {
    docs = await Product.find({ ...base, slug }).limit(limit).populate(POPULATE).lean();
  } else {
    // 1) Todas las palabras deben aparecer en el slug del producto (sin acentos).
    //    "polo manga larga" -> playera-tipo-polo-manga-larga
    const tokens = slugify(q, { lower: true, strict: true, trim: true }).split('-').filter(Boolean);
    if (tokens.length) {
      const re = tokens.map((t) => `(?=.*${esc(t)})`).join('');
      docs = await Product.find({ ...base, slug: { $regex: `^${re}.*$` } }).limit(limit).populate(POPULATE).lean();
    }
    // 2) Si no hubo coincidencia, búsqueda de texto completo (nombre/descripción).
    //    Es APROXIMADA (basta con que coincida una palabra), así que se marca
    //    para que el bot verifique que sea el producto que pidió el cliente.
    if (docs.length === 0) {
      docs = await Product.find({ ...base, $text: { $search: q } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } }).limit(limit).populate(POPULATE).lean();
      aproximada = docs.length > 0;
    }
  }

  return respond(req, res, docs, aproximada);
});

function respond(req, res, docs, aproximada = false) {
  const fichas = docs.map(armarFicha);
  if (req.query.formato === 'texto') {
    const aviso = aproximada
      ? 'COINCIDENCIA APROXIMADA: no hay un producto con ese nombre exacto. Estos resultados son parecidos. Si el nombre del producto de abajo NO es el que pidió el cliente, no uses estos datos y dile que una asesora lo confirma.\n\n'
      : '';
    const out = fichas.length
      ? aviso + fichas.map(aTexto).join('\n\n---\n\n')
      : 'SIN RESULTADOS: no hay un producto con ese nombre en el catálogo. No inventes datos; dile al cliente que una asesora lo confirma.';
    return res.type('text/plain; charset=utf-8').send(out);
  }
  return res.json({ success: true, total: fichas.length, aproximada, data: fichas });
}
