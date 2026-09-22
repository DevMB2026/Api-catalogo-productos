const Product = require('../models/product.model');
const ProductPrice = require('../models/productPrice.model');
const Brand = require('../models/brand.model');
const OptionValue = require('../models/optionValue.model');
const asyncHandler = require('../utils/asyncHandler');
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

function shapeProducto(p, priceDoc, permitidos, ovs, colorOptionIds) {
  const id = (x) => String(x && x._id ? x._id : x);
  const colorOpt = (p.options || []).find((o) => colorOptionIds.has(id(o.option)));
  const posColor = new Map((colorOpt?.values || []).map((v, i) => [id(v), i]));
  const precios = preciosPermitidos(priceDoc, permitidos);
  const rangosMarca = rangosPrecio(p._id, p.brand?.slug);
  const rangos = {};
  for (const tipo of Object.keys(precios)) if (rangosMarca[tipo]) rangos[tipo] = rangosMarca[tipo];

  const variantes = (p.variants || [])
    .filter((v) => v.activo !== false)
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

  const principal = (p.media || []).find((m) => m.principal) || (p.media || [])[0];
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
    Product.find(filtro)
      .select('nombre slug sku brand category sexo media options variants updatedAt')
      .populate('brand', 'nombre slug')
      .populate('category', 'nombre slug')
      .sort({ nombre: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Product.countDocuments(filtro)
  ]);

  const ids = productos.map((p) => p._id);
  const ovIds = [...new Set(productos.flatMap((p) => (p.variants || []).flatMap((v) => (v.optionValues || []).map(String))))];
  const [precios, valores] = await Promise.all([
    ProductPrice.find({ product: { $in: ids } }).lean(),
    OptionValue.find({ _id: { $in: ovIds } }).populate('option', 'slug tipo').lean()
  ]);
  const precioPor = new Map(precios.map((d) => [String(d.product), d]));
  const ovs = new Map(valores.map((o) => [String(o._id), { ...o, option: String(o.option?._id || o.option) }]));
  const colorOptionIds = new Set(valores.filter((o) => o.option && (o.option.slug === 'color' || o.option.tipo === 'swatch')).map((o) => String(o.option._id)));

  res.json({
    success: true,
    data: productos.map((p) => shapeProducto(p, precioPor.get(String(p._id)), req.cliente.pricePermissions, ovs, colorOptionIds)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});
