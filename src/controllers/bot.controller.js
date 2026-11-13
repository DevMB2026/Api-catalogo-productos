const slugify = require('slugify');
const Product = require('../models/product.model');
const Brand = require('../models/brand.model');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { quitarValoresOcultos } = require('../utils/valoresOcultos');
const { jpgUrl } = require('../services/storage.service'); // el bot manda copias JPG (WhatsApp no acepta WebP)

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

const MAX_FOTOS_COLOR = 4;
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Fotos del producto (ya sin colores ocultos). Cada foto está ligada a un color
// (media.optionValue) y, opcionalmente, a un público (sexo: hombre/mujer).
//  - Sin `color`: UNA foto por color (la primera por orden), para ver qué hay.
//  - Con `color`: hasta MAX_FOTOS_COLOR fotos de ese color, ordenadas, filtrando por
//    `sexo` si se pide (las fotos sin sexo sirven para cualquiera).
function fotosDe(p, { color, sexo } = {}) {
  const fotos = (p.media || [])
    .filter((m) => m && m.url && m.optionValue && m.optionValue.valor)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const porColor = new Map();
  for (const m of fotos) {
    const c = m.optionValue.valor;
    if (!porColor.has(c)) porColor.set(c, []);
    porColor.get(c).push(m);
  }
  const coloresConFoto = [...porColor.keys()];
  const quiere = color ? sinAcentos(color) : null;
  if (!quiere) {
    return { coloresConFoto, fotos: coloresConFoto.map((c) => ({ color: c, sexo: porColor.get(c)[0].sexo || null, url: jpgUrl(porColor.get(c)[0].url) })) };
  }
  const elegido = coloresConFoto.find((c) => sinAcentos(c) === quiere) || coloresConFoto.find((c) => sinAcentos(c).includes(quiere));
  if (!elegido) return { coloresConFoto, fotos: [] };
  let lista = porColor.get(elegido);
  if (sexo) lista = lista.filter((m) => !m.sexo || m.sexo === sexo);
  return { coloresConFoto, fotos: lista.slice(0, MAX_FOTOS_COLOR).map((m) => ({ color: elegido, sexo: m.sexo || null, url: jpgUrl(m.url) })) };
}

function armarFicha(raw, opts = {}) {
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

  const imagenes = opts.fotos ? fotosDe(p, opts) : null;

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
    preguntas_frecuentes: (p.faq || []).slice(0, MAX_FAQ).map((f) => ({ pregunta: f.pregunta, respuesta: f.respuesta })),
    imagenes,
    _pidioColor: opts.color || null
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
  if (f.imagenes) {
    const { coloresConFoto, fotos } = f.imagenes;
    if (fotos.length === 0) {
      L.push(f._pidioColor
        ? `FOTOS: no hay fotos del color "${f._pidioColor}". Colores con foto: ${coloresConFoto.join(', ') || 'ninguno'}. Díselo al cliente; no mandes fotos de otro producto.`
        : 'FOTOS: este producto no tiene fotos. No mandes imágenes; dile que una asesora se las comparte.');
    } else {
      L.push(f._pidioColor
        ? `FOTOS del color ${fotos[0].color} (envía estas direcciones tal cual, sin cambiarlas):`
        : 'FOTOS (una por color; para ver más de un color pide la ficha de nuevo con &color=NOMBRE; envía las direcciones tal cual):');
      for (const x of fotos) L.push(`- ${x.color}${x.sexo ? ` (${x.sexo})` : ''}: ${x.url}`);
    }
  }
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
  { path: 'sizeChartMujer' },
  { path: 'media.optionValue', select: 'valor' } // color al que pertenece cada foto
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
  // ?fotos=1 incluye las fotos; ?color=Negro filtra por color; ?sexo=hombre|mujer por público.
  const sexoPedido = ['hombre', 'mujer'].includes(String(req.query.sexo || '').toLowerCase()) ? String(req.query.sexo).toLowerCase() : null;
  const opts = {
    fotos: req.query.fotos === '1' || req.query.fotos === 'true',
    color: req.query.color ? String(req.query.color).slice(0, 40) : null,
    sexo: sexoPedido
  };
  const fichas = docs.map((d) => armarFicha(d, opts));
  if (req.query.formato === 'texto') {
    const aviso = aproximada
      ? 'COINCIDENCIA APROXIMADA: no hay un producto con ese nombre exacto. Estos resultados son parecidos. Si el nombre del producto de abajo NO es el que pidió el cliente, no uses estos datos y dile que una asesora lo confirma.\n\n'
      : '';
    const out = fichas.length
      ? aviso + fichas.map(aTexto).join('\n\n---\n\n')
      : 'SIN RESULTADOS: no hay un producto con ese nombre en el catálogo. No inventes datos; dile al cliente que una asesora lo confirma.';
    return res.type('text/plain; charset=utf-8').send(out);
  }
  return res.json({ success: true, total: fichas.length, aproximada, data: fichas.map(({ _pidioColor, ...resto }) => resto) });
}
