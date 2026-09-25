const Product = require('../models/product.model');
const ProductPrice = require('../models/productPrice.model');
const Brand = require('../models/brand.model');
const OptionValue = require('../models/optionValue.model');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { rangosPrecio } = require('../utils/preciosReglas');

// Catálogo para CLIENTES con API Key (clientKeyAuth): productos activos con
// sus SKUs por variante y los precios que ese cliente tiene permitidos, en
// una sola respuesta JSON pensada para consumirse "en crudo" por sistemas.
// Controlador propio a propósito: los controladores públicos y de
// distribuidor siguen sin tocar ProductPrice (ver productPrice.model.js).

const SEXO = { hombre: 'Caballero', mujer: 'Dama', unisex: 'Unisex' };

// Solo los niveles permitidos; uno permitido pero sin capturar sale como
// null ("aún no definido"), igual que GET /precios/productos/:id.
function preciosPermitidos(priceDoc, permitidos) {
  const out = {};
  for (const tipo of permitidos) out[tipo] = priceDoc ? priceDoc[tipo] ?? null : null;
  return out;
}

const conRefs = (query) => query
  .select('nombre slug sku brand category sexo media options variants valoresOcultos updatedAt activo')
  .populate('brand', 'nombre slug')
  .populate('category', 'nombre slug')
  .lean();

// Arma la respuesta de varios productos con sus precios y valores de opción
// (una consulta para todos, no una por producto).
async function armar(productos, permitidos) {
  const ids = productos.map((p) => p._id);
  const ovIds = [...new Set(productos.flatMap((p) => (p.variants || []).flatMap((v) => (v.optionValues || []).map(String))))];
  const [precios, valores] = await Promise.all([
    ProductPrice.find({ product: { $in: ids } }).lean(),
    OptionValue.find({ _id: { $in: ovIds } }).populate('option', 'slug tipo').lean()
  ]);
  const precioPor = new Map(precios.map((d) => [String(d.product), d]));
  const ovs = new Map(valores.map((o) => [String(o._id), { ...o, option: String(o.option?._id || o.option) }]));
  const colorOptionIds = new Set(valores.filter((o) => o.option && (o.option.slug === 'color' || o.option.tipo === 'swatch')).map((o) => String(o.option._id)));
  return productos.map((p) => shapeProducto(p, precioPor.get(String(p._id)), permitidos, ovs, colorOptionIds));
}

function shapeProducto(p, priceDoc, permitidos, ovs, colorOptionIds) {
  const id = (x) => String(x && x._id ? x._id : x);
  const colorOpt = (p.options || []).find((o) => colorOptionIds.has(id(o.option)));
  const posColor = new Map((colorOpt?.values || []).map((v, i) => [id(v), i]));
  const precios = preciosPermitidos(priceDoc, permitidos);
  const rangosMarca = rangosPrecio(p._id, p.brand?.slug);
  const rangos = {};
  for (const tipo of Object.keys(precios)) if (rangosMarca[tipo]) rangos[tipo] = rangosMarca[tipo];

  // Colores/valores ocultos (Product.valoresOcultos): sus variantes y SKUs no salen.
  const ocultos = new Set((p.valoresOcultos || []).map(id));
  const variantes = (p.variants || [])
    .filter((v) => v.activo !== false)
    .filter((v) => !(v.optionValues || []).some((x) => ocultos.has(id(x))))
    .map((v) => {
      const vals = (v.optionValues || []).map((x) => ovs.get(id(x))).filter(Boolean);
      const color = vals.find((o) => colorOptionIds.has(String(o.option)));
      const talla = vals.find((o) => o !== color);
      return {
        color: color?.valor ?? null,
        talla: talla?.valor ?? null,
        skuInterno: v.sku,
        skus: (v.skusErp || []).map((e) => ({ sku: e.sku, genero: SEXO[e.sexo] || e.sexo })),
        _orden: [color ? posColor.get(id(color)) ?? 999 : 999, talla?.orden ?? 999]
      };
    })
    .sort((a, b) => a._orden[0] - b._orden[0] || a._orden[1] - b._orden[1])
    .map(({ _orden, ...v }) => v);

  const fotos = (p.media || []).filter((m) => !m.optionValue || !ocultos.has(id(m.optionValue)));
  const principal = fotos.find((m) => m.principal) || fotos[0];
  return {
    _id: p._id,
    nombre: p.nombre,
    slug: p.slug,
    sku: p.sku,
    marca: p.brand ? { nombre: p.brand.nombre, slug: p.brand.slug } : null,
    categoria: p.category ? { nombre: p.category.nombre, slug: p.category.slug } : null,
    genero: (Array.isArray(p.sexo) ? p.sexo : [p.sexo]).filter(Boolean).map((s) => SEXO[s] || s),
    imagen: principal ? principal.url : null,
    precios,
    rangos,
    moneda: 'MXN',
    iva: 'no incluido (precio + IVA)',
    variantes,
    actualizado: p.updatedAt
  };
}

// GET /api/v1/clientes/productos?page=1&limit=20&brand=prezenza&q=chamarra
exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const filtro = { activo: true };
  if (typeof req.query.brand === 'string' && req.query.brand) {
    const b = await Brand.findOne({ slug: req.query.brand.toLowerCase() }).select('_id');
    filtro.brands = b ? b._id : null;
  }
  if (typeof req.query.q === 'string' && req.query.q.trim()) filtro.$text = { $search: req.query.q.trim() };

  const [productos, total] = await Promise.all([
    conRefs(Product.find(filtro)).sort({ nombre: 1 }).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filtro)
  ]);

  res.json({
    success: true,
    data: await armar(productos, req.cliente.pricePermissions),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

// GET /api/v1/clientes/productos/:id — un producto activo (inactivo = 404).
exports.getById = asyncHandler(async (req, res) => {
  const p = await conRefs(Product.findOne({ _id: req.params.id, activo: true }));
  if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  const [data] = await armar([p], req.cliente.pricePermissions);
  res.json({ success: true, data });
});

// GET /api/v1/clientes/productos/sku/:sku — busca por SKU del producto, alias,
// SKU de línea dama/caballero o SKU del ERP de una variante (igual que
// /products/sku/:sku). Si era de una variante, `varianteEncontrada` dice cuál.
exports.getBySku = asyncHandler(async (req, res) => {
  const sku = String(req.params.sku).trim().toUpperCase();
  const p = await conRefs(Product.findOne({
    activo: true,
    $or: [{ sku }, { 'skuAliases.sku': sku }, { skuHombre: sku }, { skuMujer: sku }, { 'variants.skusErp.sku': sku }]
  }));
  if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  // El SKU de una variante de un color oculto no existe para el cliente.
  const ocultos = new Set((p.valoresOcultos || []).map(String));
  const deOculto = (p.variants || []).some((x) => (x.skusErp || []).some((e) => e.sku === sku)
    && (x.optionValues || []).some((ov) => ocultos.has(String(ov))));
  if (deOculto) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  const [data] = await armar([p], req.cliente.pricePermissions);
  const v = data.variantes.find((x) => x.skus.some((e) => e.sku === sku));
  res.json({
    success: true,
    data,
    ...(v && { varianteEncontrada: { color: v.color, talla: v.talla, sku, genero: v.skus.find((e) => e.sku === sku).genero } })
  });
});

// GET /api/v1/clientes/productos/changes?since=<ISO> — para sincronizar sin
// releer todo. Un producto "cambió" si cambió el producto O su precio (los
// precios viven en ProductPrice: su updatedAt no toca el del producto). Si
// cambiaron los permisos del propio cliente desde `since`, cambian todos sus
// precios: se devuelve el catálogo completo (resincronizacionCompleta).
// Un producto desactivado sale como { _id, sku, activo:false } — sin datos ni
// precios — para que el consumidor lo quite.
// Sin `since` = sincronización completa. Se vuelve a llamar con el
// `serverTime` devuelto; si `hayMas` es true, llamar de nuevo enseguida.
// `limit` opcional (máximo y valor por defecto: CHANGES_LIMIT).
const CHANGES_LIMIT = 200;
exports.changes = asyncHandler(async (req, res) => {
  const serverTime = new Date();
  let since = req.query.since ? new Date(String(req.query.since)) : new Date(0);
  if (Number.isNaN(since.getTime())) {
    throw new AppError(400, 'INVALID_SINCE', 'El parámetro "since" debe ser una fecha ISO válida');
  }
  // Un cambio en la cuenta del cliente (p. ej. sus permisos) cambia TODOS sus
  // precios: cuenta como un cambio de cada producto con ese momento. Así el
  // cursor siempre avanza (nunca se reinicia a mitad de una paginación).
  const cuenta = req.cliente.actualizado || new Date(0);
  const permisosCambiaron = Boolean(req.query.since) && cuenta > since;

  const preciosCambiados = await ProductPrice.find({ updatedAt: { $gt: since } }).select('product updatedAt').lean();
  const cambioPrecio = new Map(preciosCambiados.map((d) => [String(d.product), d.updatedAt]));
  const candidatos = await conRefs(Product.find(cuenta > since ? {} : {
    $or: [{ updatedAt: { $gt: since } }, { _id: { $in: preciosCambiados.map((d) => d.product) } }]
  }));

  // Momento efectivo del cambio: el más reciente entre producto, precio y cuenta.
  const conMomento = candidatos
    .map((p) => {
      const momentos = [p.updatedAt, cambioPrecio.get(String(p._id)), cuenta].filter(Boolean);
      return { p, momento: new Date(Math.max(...momentos.map((x) => x.getTime()))) };
    })
    .filter((x) => x.momento > since)
    .sort((a, b) => a.momento - b.momento);

  // Si hay más del límite, se corta en un límite de tiempo (nunca a mitad de
  // una misma marca de tiempo) para que la siguiente llamada no se salte nada.
  const limite = Math.min(CHANGES_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || CHANGES_LIMIT));
  let lote = conMomento;
  let hayMas = false;
  if (conMomento.length > limite) {
    const corte = conMomento[limite - 1].momento.getTime();
    lote = conMomento.filter((x) => x.momento.getTime() <= corte);
    hayMas = lote.length < conMomento.length;
  }

  const activos = lote.filter((x) => x.p.activo !== false).map((x) => x.p);
  const armados = new Map((await armar(activos, req.cliente.pricePermissions)).map((d) => [String(d._id), d]));
  const data = lote.map(({ p }) => (p.activo === false
    ? { _id: p._id, sku: p.sku, activo: false, actualizado: p.updatedAt }
    : { ...armados.get(String(p._id)), activo: true }));

  res.json({
    success: true,
    data,
    serverTime: hayMas ? lote[lote.length - 1].momento.toISOString() : serverTime.toISOString(),
    hayMas,
    ...(permisosCambiaron && { resincronizacionCompleta: true })
  });
});
