const jwt = require('jsonwebtoken');
const AppError = require('./AppError');
const User = require('../models/user.model');

// Valores de opción ocultos (Product.valoresOcultos): el producto los TIENE
// (variantes, SKUs, fotos) pero no se muestran. Toda lectura pública, de
// distribuidor o de cliente pasa el producto por quitarValoresOcultos().

const idDe = (x) => String(x && x._id ? x._id : x);

// Devuelve el producto como objeto plano sin los valores ocultos: fuera de
// options[].values, fuera las variantes que usan alguno (con sus SKUs) y fuera
// las fotos ligadas a ellos. Tampoco se expone la lista `valoresOcultos`.
// Acepta un documento de Mongoose o un objeto plano (lean/aggregate).
function quitarValoresOcultos(product) {
  if (!product) return product;
  const p = typeof product.toJSON === 'function' ? product.toJSON() : { ...product };
  const ocultos = new Set((p.valoresOcultos || []).map(idDe));
  delete p.valoresOcultos;
  if (ocultos.size === 0) return p;

  const visible = (v) => !ocultos.has(idDe(v));
  if (Array.isArray(p.options)) {
    p.options = p.options.map((o) => ({ ...o, values: (o.values || []).filter(visible) }));
  }
  if (Array.isArray(p.variants)) {
    p.variants = p.variants.filter((v) => (v.optionValues || []).every(visible));
  }
  if (Array.isArray(p.media)) {
    p.media = p.media.filter((m) => !m.optionValue || visible(m.optionValue));
  }
  return p;
}

// ?incluirOcultos=true -> el panel de admin pide el producto COMPLETO (para
// editarlo sin perder los valores ocultos al guardar). Solo con token de admin
// válido y cuenta activa (mismo criterio que requireAdmin). Si lo piden sin
// credenciales válidas se responde error en vez de devolver la versión
// recortada: así el panel nunca guarda por accidente un producto sin sus
// colores ocultos (p. ej. con la sesión vencida).
async function puedeVerOcultos(req) {
  if (req.query.incluirOcultos !== 'true') return false;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !process.env.JWT_SECRET) {
    throw new AppError(401, 'NO_TOKEN', 'incluirOcultos requiere sesión de administrador');
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    throw new AppError(401, 'INVALID_TOKEN', 'Token inválido o expirado');
  }
  const user = await User.findById(payload.sub).select('role activo');
  if (!user || !user.activo || user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'incluirOcultos requiere rol de administrador');
  }
  return true;
}

module.exports = { quitarValoresOcultos, puedeVerOcultos, idDe };
