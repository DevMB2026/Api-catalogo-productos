const Product = require('../models/product.model');
const Brand = require('../models/brand.model');
const Category = require('../models/category.model');
const Catalog = require('../models/catalog.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateUniqueSlug } = require('../utils/slug');
const { uploadBuffer, destroy, ensureConfigured } = require('../services/cloudinary.service');
const { validateProductDynamic } = require('../services/productValidation.service');
const { notificarEventoProducto, dispararWebhookSiAplica } = require('../services/notification.service');

// Suma el stock de todas las variantes — "sin stock" = 0 en todas.
function stockTotal(product) {
  return (product.variants || []).reduce((sum, v) => sum + (v.stock || 0), 0);
}

// Dispara los avisos de desactivación/agotamiento según el estado ANTES vs
// DESPUÉS de guardar. No bloquea la respuesta al admin ni la revienta si el
// envío de correo falla — solo lo deja registrado en el historial.
function dispararNotificacionesSiAplica(antes, despues) {
  const seDesactivo = antes.activo && !despues.activo;
  const seAgoto = stockTotal(antes) > 0 && stockTotal(despues) === 0;

  if (seDesactivo) {
    notificarEventoProducto('desactivado', despues).catch((e) => console.warn('[notificaciones] error:', e.message));
  }
  if (seAgoto) {
    notificarEventoProducto('agotado', despues).catch((e) => console.warn('[notificaciones] error:', e.message));
  }
}

// Fire-and-forget hacia los webhooks de distribuidores (ver
// services/notification.service.js) — a diferencia de las notificaciones por
// correo, este se dispara en TODA escritura (alta/edición/baja), porque el
// objetivo es que la base de datos local del plugin quede sincronizada, no
// solo avisar de un evento puntual.
function dispararWebhook(product, evento) {
  dispararWebhookSiAplica(product, evento).catch((e) => console.warn('[webhooks] error:', e.message));
}

// "Todos los de su marca principal, MÁS los elegidos a mano" — misma
// membresía brands[] que ya usa ?brand=, combinada con un $in explícito.
// NUNCA modifica Product.brands[]: es solo una condición de lectura.
function catalogToCondition(catalog) {
  const or = [];
  if (catalog.marcaPrincipal) or.push({ brands: catalog.marcaPrincipal });
  if (catalog.productosAdicionales && catalog.productosAdicionales.length > 0) {
    or.push({ _id: { $in: catalog.productosAdicionales } });
  }
  // Catálogo sin marca principal ni productos (mal configurado): no debe
  // devolver "todo" por accidente — devuelve nada, explícitamente.
  return or.length > 0 ? { $or: or } : { _id: null };
}

// ?catalogo=slug — libre para cualquier consumidor público (WordPress, etc.).
async function resolveCatalogConditionBySlug(slug) {
  const catalog = await Catalog.findOne({ slug: String(slug).toLowerCase(), activo: true });
  if (!catalog) {
    throw new AppError(400, 'INVALID_CATALOG', `El catálogo "${slug}" no existe`, { catalogo: slug });
  }
  return catalogToCondition(catalog);
}

// Catálogo ASIGNADO a un distribuidor (req.distribuidor.catalogo, resuelto en
// apiKeyAuth desde User.catalogo — nunca desde algo que el cliente mande).
// Si el catálogo asignado fue borrado/desactivado, falla CERRADO (no
// devuelve todo por accidente): el distribuidor ve cero productos hasta que
// el admin le asigne uno válido de nuevo.
async function resolveCatalogConditionById(catalogId) {
  const catalog = await Catalog.findOne({ _id: catalogId, activo: true });
  if (!catalog) return { _id: null };
  return catalogToCondition(catalog);
}

// Aplica el catálogo asignado del distribuidor (si tiene uno) por encima de
// cualquier filtro que el cliente haya pedido — se llama SIEMPRE al final de
// armar el filtro de list(), así ningún otro parámetro puede ampliarlo.
async function applyDistribuidorCatalogScope(filtro, req) {
  if (req.distribuidor && req.distribuidor.catalogo) {
    Object.assign(filtro, await resolveCatalogConditionById(req.distribuidor.catalogo));
  }
}

// Para getById/getBySlug/getBySku: si el distribuidor tiene catálogo
// asignado y el producto encontrado no pertenece a él, se responde 404 (no
// 403) — mismo principio de no revelar por qué, ya usado en toda la API.
async function enforceDistribuidorCatalogOrThrow(product, req) {
  if (!req.distribuidor || !req.distribuidor.catalogo) return;
  const condition = await resolveCatalogConditionById(req.distribuidor.catalogo);
  const pertenece = await Product.exists({ _id: product._id, ...condition });
  if (!pertenece) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
}

// Populate profundo para el detalle (todo lo que el catálogo/panel necesita).
const withRefs = (query) => query
  .populate('brand', 'nombre slug')
  .populate('brands', 'nombre slug')
  .populate('skuAliases.brand', 'nombre slug')
  .populate('category', 'nombre slug')
  .populate('attributes.attribute')
  .populate('features')
  .populate('applications')
  .populate('options.option')
  .populate('options.values')
  .populate('variants.optionValues')
  .populate('sizeChart')
  .populate('sizeChartHombre')
  .populate('sizeChartMujer');

// Populate ligero para el listado.
const withRefsLite = (query) => query
  .populate('brand', 'nombre slug')
  .populate('brands', 'nombre slug')
  .populate('category', 'nombre slug');

// Arma el filtro de Mongo compartido por list() y changes(): resuelve activo,
// scope de catálogo (distribuidor o ?catalogo=), y el resto de los filtros de
// query. `includeInactive` es para changes(), que necesita ver también los
// productos recién desactivados (para poder purgarlos del lado del consumidor).
async function buildProductFiltro(req, { includeInactive = false } = {}) {
  const { brand, brands, category, sexo, activo, sku, slug, q, destacado, catalogo } = req.query;
  const filtro = {};

  if (includeInactive) {
    // changes() siempre necesita ambos estados — no hay ?activo= relevante aquí.
  } else if (activo === undefined) {
    filtro.activo = true;
  } else if (activo !== 'all') {
    filtro.activo = activo === 'true';
  }

  if (req.distribuidor && req.distribuidor.catalogo) {
    // Distribuidor con catálogo asignado: gana SIEMPRE. Se ignora cualquier
    // ?catalogo= que el cliente haya mandado — no puede cambiarlo por parámetro.
    await applyDistribuidorCatalogScope(filtro, req);
  } else if (catalogo) {
    // ?catalogo=prezenza -> libre para cualquier consumidor público
    // (WordPress, admin, o un distribuidor SIN catálogo asignado).
    Object.assign(filtro, await resolveCatalogConditionBySlug(catalogo));
  }

  if (brands) {
    // Selección múltiple (ej. checkboxes del distribuidor en /distribuidor):
    // ?brands=marca-a,marca-b -> productos con AL MENOS UNA de esas marcas en
    // brands[]. A diferencia de ?brand=, una marca inexistente responde 400
    // explícito en vez de devolver silenciosamente una lista vacía.
    const slugsPedidos = [...new Set(String(brands).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
    if (slugsPedidos.length > 0) {
      const encontradas = await Brand.find({ slug: { $in: slugsPedidos } }).select('_id slug');
      const encontradasSet = new Set(encontradas.map((b) => b.slug));
      const invalidas = slugsPedidos.filter((s) => !encontradasSet.has(s));
      if (invalidas.length > 0) {
        throw new AppError(400, 'INVALID_BRAND', `Marca(s) no válida(s): ${invalidas.join(', ')}`, { brands: invalidas });
      }
      filtro.brands = { $in: encontradas.map((b) => b._id) };
    }
  } else if (brand) {
    // Filtra por MEMBRESÍA en brands[] (no solo la marca principal): así el
    // catálogo de una firma incluye también los productos multi-marca compartidos.
    const b = await Brand.findOne({ slug: brand.toLowerCase() }).select('_id');
    filtro.brands = b ? b._id : null;
  }
  if (category) {
    const c = await Category.findOne({ slug: category.toLowerCase() }).select('_id');
    filtro.category = c ? c._id : null;
  }
  if (sexo) filtro.sexo = sexo;
  if (destacado !== undefined) filtro.destacado = destacado === 'true';
  if (sku) filtro.sku = sku.toUpperCase();
  if (slug) filtro.slug = slug.toLowerCase();
  if (q) filtro.$text = { $search: q };

  return filtro;
}

// GET /api/v1/products — filtros básicos + búsqueda + paginación
exports.list = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const filtro = await buildProductFiltro(req);

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  let sort = { createdAt: -1 };
  if (q) sort = { score: { $meta: 'textScore' } };
  if (req.query.sort) {
    sort = {};
    for (const part of req.query.sort.split(',')) {
      if (!part) continue;
      sort[part.replace(/^-/, '')] = part.startsWith('-') ? -1 : 1;
    }
  }

  let query = Product.find(filtro);
  if (q) query = query.select({ score: { $meta: 'textScore' } });
  query = withRefsLite(query).sort(sort).skip(skip).limit(limit);

  const [data, total] = await Promise.all([query, Product.countDocuments(filtro)]);
  res.json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  });
});

// GET /api/v1/products/changes?since=<ISO> — para que un consumidor (plugin
// de WordPress con base de datos local) sepa qué sincronizar sin tener que
// releer todo el catálogo. Devuelve productos activos E inactivos (para que
// el consumidor pueda reflejar una desactivación), con el mismo detalle
// completo que getBySlug/getById (withRefs, no withRefsLite) — a diferencia
// de list(), esto es lo único que alimenta la base de datos local del
// consumidor, así que un producto sincronizado por aquí debe traer todo lo
// necesario para renderizar también su ficha de detalle, no solo la tarjeta
// del grid.
//
// since=epoch (el valor por defecto) hace, en la práctica, una "sync
// completa": el consumidor pagina llamando de nuevo con el `serverTime`
// devuelto hasta recibir menos de CHANGES_LIMIT resultados — con eso ya
// tiene TODO el catálogo, sin necesitar un endpoint de listado separado.
// Ordenados por updatedAt ascendente para que la paginación por cursor no
// se salte nada. `serverTime` se toma ANTES de consultar, para no perder
// cambios que ocurran entre el query y la respuesta.
const CHANGES_LIMIT = 200;
exports.changes = asyncHandler(async (req, res) => {
  const serverTime = new Date();
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  if (Number.isNaN(since.getTime())) {
    throw new AppError(400, 'INVALID_SINCE', 'El parámetro "since" debe ser una fecha ISO válida');
  }

  const filtro = await buildProductFiltro(req, { includeInactive: true });
  filtro.updatedAt = { $gt: since };

  const data = await withRefs(Product.find(filtro))
    .sort({ updatedAt: 1 })
    .limit(CHANGES_LIMIT);

  res.json({ success: true, data, serverTime: serverTime.toISOString() });
});

exports.getById = asyncHandler(async (req, res) => {
  const product = await withRefs(Product.findById(req.params.id));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  await enforceDistribuidorCatalogOrThrow(product, req);
  res.json({ success: true, data: product });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const product = await withRefs(Product.findOne({ slug: req.params.slug.toLowerCase() }));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  await enforceDistribuidorCatalogOrThrow(product, req);
  res.json({ success: true, data: product });
});

exports.getBySku = asyncHandler(async (req, res) => {
  const sku = req.params.sku.toUpperCase();
  // Matchea el SKU principal O cualquier alias (SKU secundario de otro sitio/marca).
  const product = await withRefs(Product.findOne({ $or: [{ sku }, { 'skuAliases.sku': sku }] }));
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  await enforceDistribuidorCatalogOrThrow(product, req);
  res.json({ success: true, data: product });
});

// POST /api/v1/products  (admin) — Zod (forma) + validación dinámica (semántica)
exports.create = asyncHandler(async (req, res) => {
  await validateProductDynamic(req.body, { partial: false });
  const data = { ...req.body };
  if (!data.slug && data.nombre) data.slug = await generateUniqueSlug(Product, data.nombre);
  const created = await Product.create(data);
  dispararWebhook(created, 'creado');
  const full = await withRefs(Product.findById(created._id));
  res.status(201).json({ success: true, data: full });
});

// PATCH /api/v1/products/:id  (admin)
// Se valida el ESTADO FINAL (existente + cambios), no solo el parche: así se
// resuelve el esquema por la categoría real y se detectan incoherencias
// (p. ej. una variante que quedaría usando un valor de opción ya no declarado).
exports.update = asyncHandler(async (req, res) => {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  const merged = { ...existing.toObject(), ...req.body };
  await validateProductDynamic(merged, { partial: false });

  const updates = { ...req.body };
  if (updates.nombre && !updates.slug) updates.slug = await generateUniqueSlug(Product, updates.nombre, req.params.id);

  // Si cambia la marca PRINCIPAL sin que el caller mande `brands` explícito
  // (el form de admin solo edita `brand`), hay que mantener sincronizada la
  // lista de membresía: reemplaza la marca anterior por la nueva ahí donde
  // aparezca, preservando cualquier marca adicional (ej. la agregada por
  // scripts como tag-brand-overlap.js). findByIdAndUpdate NO corre el
  // pre('validate') del modelo, así que sin esto `brands` queda huérfano de
  // la marca real y el producto desaparece de los filtros por esa marca.
  if (updates.brand && !updates.brands) {
    const oldBrand = String(existing.brand);
    const newBrand = String(updates.brand);
    const currentBrands = (existing.brands || []).map(String);
    updates.brands = currentBrands.includes(oldBrand)
      ? currentBrands.map((b) => (b === oldBrand ? newBrand : b))
      : [...new Set([newBrand, ...currentBrands])];
  }

  const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  dispararNotificacionesSiAplica(existing, product);
  dispararWebhook(product, 'actualizado');
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});

// DELETE /api/v1/products/:id — soft por defecto; ?hard=true borra físico + Cloudinary
exports.remove = asyncHandler(async (req, res) => {
  if (req.query.hard === 'true') {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
    const publicIds = [
      ...product.media.map((m) => m.public_id),
      ...product.variants.flatMap((v) => v.media.map((m) => m.public_id))
    ].filter(Boolean);
    for (const pid of publicIds) {
      try { await destroy(pid); } catch { console.warn('No se pudo borrar en Cloudinary:', pid); }
    }
    const productId = product._id;
    await product.deleteOne();
    // El producto ya no existe: no hay changes()/updatedAt que lo refleje, así
    // que es el ÚNICO caso donde el webhook debe llevar el id directamente
    // (el plugin lo borra de su tabla local en vez de resincronizarlo).
    dispararWebhook({ _id: productId, updatedAt: new Date() }, 'eliminado');
    return res.json({ success: true, message: 'Producto eliminado permanentemente' });
  }
  const antes = await Product.findById(req.params.id);
  if (!antes) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  const product = await Product.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
  dispararNotificacionesSiAplica(antes, product);
  dispararWebhook(product, 'eliminado');
  res.json({ success: true, message: 'Producto desactivado (soft delete)', data: { _id: product._id, activo: product.activo } });
});

// POST /api/v1/products/:id/images — sube a la galería del producto.
// Si viene `optionValue` (ej. el id del color "Negro"), la imagen queda
// ligada a ese valor y se comparte entre TODAS las tallas de ese color (no
// se sube una vez por cada combinación color+talla). Sin `optionValue`, la
// imagen es general (sirve para cualquier color).
exports.addImages = asyncHandler(async (req, res) => {
  ensureConfigured();
  if (!req.files || req.files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'No se recibieron imágenes en el campo "imagenes"');
  }
  const product = await Product.findById(req.params.id).populate('brand', 'slug');
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  const optionValue = req.body.optionValue || undefined;
  if (optionValue) {
    const declarado = product.options.some((o) => o.values.some((v) => String(v) === String(optionValue)));
    if (!declarado) throw new AppError(400, 'OPTION_VALUE_NOT_FOUND', 'El valor indicado no está declarado en las opciones del producto');
  }

  const bucket = product.media;
  const brandSlug = (product.brand && product.brand.slug) || 'sin-marca';
  const folder = `catalogo/${brandSlug}/${product.sku}`;
  const desde = bucket.length;
  for (let i = 0; i < req.files.length; i++) {
    const result = await uploadBuffer(req.files[i].buffer, folder);
    bucket.push({
      url: result.secure_url,
      public_id: result.public_id,
      orden: desde + i,
      principal: desde === 0 && i === 0,
      optionValue
    });
  }

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.status(201).json({ success: true, data: full });
});

// DELETE /api/v1/products/:id/images?public_id=... — busca en galería y en variantes
exports.removeImage = asyncHandler(async (req, res) => {
  const publicId = req.query.public_id || (req.body && req.body.public_id);
  if (!publicId) throw new AppError(400, 'PUBLIC_ID_REQUIRED', 'Falta public_id (en query o body)');

  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  let encontrada = false;
  if (product.media.some((m) => m.public_id === publicId)) {
    product.media = product.media.filter((m) => m.public_id !== publicId);
    encontrada = true;
  }
  if (!encontrada) {
    for (const variant of product.variants) {
      if (variant.media.some((m) => m.public_id === publicId)) {
        variant.media = variant.media.filter((m) => m.public_id !== publicId);
        encontrada = true;
        break;
      }
    }
  }
  if (!encontrada) throw new AppError(404, 'IMAGE_NOT_FOUND', 'La imagen no existe en este producto');

  try { await destroy(publicId); } catch { console.warn('No se pudo borrar en Cloudinary:', publicId); }

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});

// PATCH /api/v1/products/:id/images — actualiza metadata de una imagen ya
// subida: "sexo" (a qué género se muestra) y/o "optionValue" (a qué color
// pertenece — permite MOVER una foto de la galería general a un color, o
// de un color a otro, sin volver a subirla). Solo toca los campos que
// vengan en el body. No sube ni borra nada — busca la imagen por public_id
// en galería y en variantes, igual que removeImage.
exports.updateImageMeta = asyncHandler(async (req, res) => {
  const { public_id: publicId, sexo, optionValue } = req.body;

  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  let target = product.media.find((m) => m.public_id === publicId);
  if (!target) {
    for (const variant of product.variants) {
      target = variant.media.find((m) => m.public_id === publicId);
      if (target) break;
    }
  }
  if (!target) throw new AppError(404, 'IMAGE_NOT_FOUND', 'La imagen no existe en este producto');

  if (sexo !== undefined) target.sexo = sexo;
  if (optionValue !== undefined) {
    if (optionValue) {
      const declarado = product.options.some((o) => o.values.some((v) => String(v) === String(optionValue)));
      if (!declarado) throw new AppError(400, 'OPTION_VALUE_NOT_FOUND', 'El valor indicado no está declarado en las opciones del producto');
    }
    target.optionValue = optionValue || undefined;
  }

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});

// PATCH /api/v1/products/:id/images/order — reordena las imágenes de UN
// grupo (un color vía `optionValue`, o la galería general si no se manda).
// Hay que mandar la lista COMPLETA de public_id de ese grupo, en el orden
// deseado — así queda inequívoco cuál imagen va en qué posición.
exports.reorderImages = asyncHandler(async (req, res) => {
  const { optionValue, publicIds } = req.body;
  if (!Array.isArray(publicIds) || publicIds.length === 0) {
    throw new AppError(400, 'PUBLIC_IDS_REQUIRED', 'Falta la lista de public_id en el nuevo orden');
  }

  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  const perteneceAlGrupo = (m) => (optionValue ? String(m.optionValue) === String(optionValue) : !m.optionValue);
  const mediaArr = product.media.map((m) => m.toObject());
  const indices = [];
  mediaArr.forEach((m, i) => { if (perteneceAlGrupo(m)) indices.push(i); });
  if (indices.length !== publicIds.length) {
    throw new AppError(400, 'ORDER_MISMATCH', 'La lista de orden no coincide con las imágenes de este grupo');
  }

  const byPublicId = new Map(mediaArr.map((m) => [m.public_id, m]));
  const reordered = publicIds.map((pid) => byPublicId.get(pid));
  if (reordered.some((m) => !m || !perteneceAlGrupo(m))) {
    throw new AppError(400, 'IMAGE_NOT_FOUND', 'Alguna imagen del nuevo orden no existe en este grupo');
  }

  indices.forEach((idx, i) => { mediaArr[idx] = { ...reordered[i], orden: i }; });
  product.media = mediaArr;

  await product.save();
  const full = await withRefs(Product.findById(product._id));
  res.json({ success: true, data: full });
});
