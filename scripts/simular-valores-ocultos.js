// Simulación (SOLO LECTURA) de ocultar valores de opción (ej. colores) en un
// producto: muestra qué dejaría de ver el público. No escribe nada en la base.
//
// Uso: node scripts/simular-valores-ocultos.js "<nombre o slug>" "<Valor1>,<Valor2>"
//   ej. node scripts/simular-valores-ocultos.js "playera cotton" "Verde,Rojo"
require('dotenv').config();
// DNS público: el resolvedor local a veces rechaza la consulta SRV de Atlas (igual que los demás scripts).
require('dns').setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
require('../src/models/option.model');
require('../src/models/optionValue.model');
const { quitarValoresOcultos } = require('../src/utils/valoresOcultos');
const { validateProductDynamic } = require('../src/services/productValidation.service');

const [, , busqueda, valoresTxt] = process.argv;
if (!busqueda || !valoresTxt) {
  console.error('Uso: node scripts/simular-valores-ocultos.js "<nombre o slug>" "<Valor1>,<Valor2>"');
  process.exit(1);
}
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const candidatos = await Product.find({
    $or: [{ slug: busqueda.toLowerCase() }, { nombre: new RegExp(esc(busqueda), 'i') }]
  })
    .populate('options.option')
    .populate('options.values')
    .populate('variants.optionValues')
    .populate('brand', 'nombre');

  if (candidatos.length !== 1) {
    console.log(`Se encontraron ${candidatos.length} productos; afina la búsqueda:`);
    candidatos.forEach((p) => console.log(`  - ${p.nombre} | slug ${p.slug} | ${p.brand?.nombre} | ${p._id}`));
    await mongoose.disconnect();
    return;
  }
  const p = candidatos[0];
  const pedidos = valoresTxt.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const todos = p.options.flatMap((o) => o.values.map((v) => ({ eje: o.option?.nombre, v })));
  const ocultar = todos.filter(({ v }) => pedidos.includes(String(v.valor).trim().toLowerCase()));
  const faltan = pedidos.filter((t) => !ocultar.some(({ v }) => String(v.valor).trim().toLowerCase() === t));

  console.log(`Producto: ${p.nombre} (${p.brand?.nombre}) — slug ${p.slug} — id ${p._id}`);
  console.log(`Ya ocultos hoy: ${(p.valoresOcultos || []).length}`);
  for (const o of p.options) console.log(`  ${o.option?.nombre}: ${o.values.map((v) => v.valor).join(', ')}`);
  if (faltan.length) console.log(`\n⚠ No existen en este producto: ${faltan.join(', ')}`);
  console.log(`\nSe ocultarían: ${ocultar.map(({ eje, v }) => `${eje} ${v.valor} (${v._id})`).join(', ') || '(nada)'}`);

  // En memoria: NO se guarda.
  p.valoresOcultos = [...new Set([...(p.valoresOcultos || []).map(String), ...ocultar.map(({ v }) => String(v._id))])];
  const publico = quitarValoresOcultos(p);

  const skus = (vs) => vs.reduce((n, v) => n + (v.skusErp || []).length, 0);
  const fila = (t, a, b) => console.log(`  ${t.padEnd(18)} ${String(a).padStart(5)} -> ${String(b).padStart(5)}`);
  console.log('\nLo que ve el público (antes -> después):');
  for (const o of p.options) {
    const d = publico.options.find((x) => String(x.option._id || x.option) === String(o.option._id));
    fila(o.option?.nombre || 'eje', o.values.length, d ? d.values.length : 0);
  }
  fila('Variantes', p.variants.length, publico.variants.length);
  fila('SKUs del ERP', skus(p.variants), skus(publico.variants));
  fila('Fotos', p.media.length, publico.media.length);
  const quitadas = p.variants.filter((v) => !publico.variants.some((x) => String(x._id) === String(v._id)));
  console.log(`\nVariantes que dejarían de verse (${quitadas.length}):`);
  for (const v of quitadas) {
    console.log(`  ${v.optionValues.map((x) => x.valor).join(' / ').padEnd(22)} sku ${v.sku || '-'}  ERP ${(v.skusErp || []).map((e) => e.sku).join(', ') || '-'}`);
  }
  console.log(`\n¿"valoresOcultos" aparece en la respuesta pública? ${'valoresOcultos' in publico ? 'SÍ (mal)' : 'no'}`);

  // Que la validación de la API aceptaría este estado al guardarlo.
  const plano = p.toObject();
  plano.options = plano.options.map((o) => ({ option: o.option._id, values: o.values.map((v) => v._id) }));
  plano.variants = plano.variants.map((v) => ({ ...v, optionValues: v.optionValues.map((x) => x._id) }));
  try {
    await validateProductDynamic(plano, { partial: false });
    console.log('Validación de la API: OK');
  } catch (e) {
    console.log('Validación de la API: ERROR', e.message, JSON.stringify(e.details || ''));
  }
  console.log('\n(No se escribió nada en la base.)');
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
