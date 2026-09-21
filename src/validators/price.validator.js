const { z } = require('zod');

// null = "todavía no definido" (no es lo mismo que 0). Cada campo es opcional
// en el PATCH: solo se actualizan los que vengan en el body.
const priceValue = z.number().min(0, 'El precio no puede ser negativo').nullable();

const priceUpdateSchema = z.object({
  menudeo: priceValue.optional(),
  mayoreo: priceValue.optional(),
  volumen: priceValue.optional(),
  distribuidor: priceValue.optional(),
  master: priceValue.optional()
});

module.exports = { priceUpdateSchema };
