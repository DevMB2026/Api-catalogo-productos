// Rangos de cantidad por nivel de precio, por marca — la MISMA tabla que usa
// el frontend en catalogo-frontend/src/lib/preciosReglas.js (panel admin y
// ficha). Si cambian las reglas del negocio, hay que cambiarlas en ambos.
// Es solo información descriptiva para el consumidor: qué precios puede
// LEER cada cliente lo decide siempre pricePermissions.
const CINCO_NIVELES = { menudeo: '1–30 pzas', mayoreo: '31–200 pzas', volumen: '201 pzas o más', distribuidor: 'precio especial', master: 'precio especial' };
const BE_FRESH = { menudeo: '1–11 pzas', mayoreo: '12 pzas o más', master: 'precio especial' };

const POR_MARCA = { prezenza: CINCO_NIVELES, fitbefresh: BE_FRESH, befreshsecurity: BE_FRESH };
const POR_PRODUCTO = {
  '6a7decbc3d905ef7b12aaa27': CINCO_NIVELES // Camisa Pescadora (Fit Be Fresh): maneja los 5 niveles
};

const rangosPrecio = (productId, brandSlug) => POR_PRODUCTO[String(productId)] || POR_MARCA[brandSlug] || {};

module.exports = { rangosPrecio };
