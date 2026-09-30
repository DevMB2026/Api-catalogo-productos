// PATCH /products/:id con `variants` REEMPLAZA la lista completa. Los
// clientes (el panel admin, scripts) mandan solo lo que conocen: sin _id,
// sin media, a veces sin activo o composición. Sin esta fusión, cada guardado
// regeneraba los _id, borraba las fotos propias de la variante, reactivaba
// variantes desactivadas y dejaba sin composición a las tallas/colores nuevos.
//
// Regla: un campo AUSENTE (undefined) en la variante entrante conserva el
// valor de la variante existente con la MISMA combinación de optionValues.
// Un campo presente (aunque sea "" o []) se respeta tal cual — así un
// cliente sigue pudiendo cambiarlo o vaciarlo a propósito.
// Si la combinación es nueva, composición y stock ausentes se heredan: de
// las variantes existentes del mismo color primero (por si un color lleva
// otra tela), y si no, del valor más común de todo el producto.

const PRESERVAR = ['composicion', 'stock', 'media', 'activo', 'skusErp'];

const idStr = (x) => String((x && x._id) || x);
const comboKey = (optionValues = []) => optionValues.map(idStr).sort().join('|');

function masRepetido(valores) {
  const cuenta = new Map();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) || 0) + 1);
  let mejor;
  let max = 0;
  for (const [v, n] of cuenta) if (n > max) { mejor = v; max = n; }
  return mejor;
}

// Composición/stock "de referencia" de un grupo de variantes, ignorando
// vacías y stock 0 (una talla recién agregada no debe arrastrar al resto).
function comunes(variantes) {
  return {
    composicion: masRepetido(variantes.map((v) => v.composicion).filter(Boolean)),
    stock: masRepetido(variantes.map((v) => v.stock || 0).filter((n) => n > 0))
  };
}

/**
 * @param {Array} entrantes   variantes del body (ya validadas por Zod)
 * @param {Array} existentes  product.variants actuales (docs o objetos planos)
 * @param {Set<string>} [colorIds] ids de los valores del eje de color, para
 *        heredar primero del mismo color; sin él se usa el común del producto.
 */
function mergeVariants(entrantes, existentes = [], colorIds = new Set()) {
  const planas = existentes.map((v) => (typeof v.toObject === 'function' ? v.toObject() : v));
  const porCombo = new Map(planas.map((v) => [comboKey(v.optionValues), v]));
  const delProducto = comunes(planas);
  const colorDe = (v) => (v.optionValues || []).map(idStr).find((id) => colorIds.has(id));

  return entrantes.map((entrante) => {
    const previa = porCombo.get(comboKey(entrante.optionValues));
    const out = { ...entrante };

    if (previa) {
      if (out._id === undefined && previa._id) out._id = previa._id;
      for (const campo of PRESERVAR) {
        if (out[campo] === undefined && previa[campo] !== undefined) out[campo] = previa[campo];
      }
      return out;
    }

    // Combinación nueva: hereda del mismo color, y si no hay, del producto.
    const color = colorDe(entrante);
    const hermanas = color ? planas.filter((v) => colorDe(v) === color) : [];
    const delColor = comunes(hermanas);
    if (out.composicion === undefined) {
      const c = delColor.composicion || delProducto.composicion;
      if (c) out.composicion = c;
    }
    if (out.stock === undefined) {
      const s = delColor.stock || delProducto.stock;
      if (s) out.stock = s;
    }
    return out;
  });
}

module.exports = { mergeVariants, comboKey };
