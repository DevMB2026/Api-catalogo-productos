const User = require('../models/user.model');
const Notification = require('../models/notification.model');
const { sendEmail } = require('../utils/email');

// Equipo interno: lista fija por env var (separada por comas).
function equipoInterno() {
  return (process.env.INTERNAL_TEAM_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

// Todos los distribuidores activos (User role=distribuidor). No se filtra por
// catálogo asignado: la decisión fue avisar a todos, sin importar si ese
// producto en particular está en su catálogo.
async function emailsDistribuidoresActivos() {
  const distribuidores = await User.find({ role: 'distribuidor', activo: true }).select('email');
  return distribuidores.map((d) => d.email);
}

const TEXTOS = {
  desactivado: {
    asunto: (p) => `Producto desactivado: ${p.nombre}`,
    titulo: 'Producto desactivado',
    cuerpo: (p) => `El producto <strong>${p.nombre}</strong> (SKU ${p.sku}) fue desactivado y ya no aparece en el catálogo.`
  },
  agotado: {
    asunto: (p) => `Producto sin stock: ${p.nombre}`,
    titulo: 'Producto sin stock',
    cuerpo: (p) => `El producto <strong>${p.nombre}</strong> (SKU ${p.sku}) se quedó sin stock en todas sus variantes.`
  }
};

// Dispara el aviso de un evento (desactivado|agotado) para un producto:
// resuelve destinatarios, envía el correo y deja registro en el historial
// sin importar si el envío falla (para que quede trazable el intento).
async function notificarEventoProducto(evento, product) {
  const texto = TEXTOS[evento];
  const equipo = equipoInterno();
  const distribuidores = await emailsDistribuidoresActivos();
  const destinatarios = [...equipo, ...distribuidores];

  let enviadoOk = false;
  if (destinatarios.length > 0) {
    const html = `<p>${texto.cuerpo(product)}</p>`;
    const resultado = await sendEmail({
      to: equipo.length ? equipo : destinatarios[0],
      bcc: distribuidores,
      subject: texto.asunto(product),
      html
    }).catch((e) => ({ ok: false, error: e.message }));
    enviadoOk = resultado.ok;
  }

  await Notification.create({
    evento,
    producto: product._id,
    productoNombre: product.nombre,
    productoSku: product.sku,
    destinatarios,
    enviadoOk
  });
}

module.exports = { notificarEventoProducto };
