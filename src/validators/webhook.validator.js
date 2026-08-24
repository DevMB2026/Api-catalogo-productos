const { z } = require('zod');

const webhookRegisterSchema = z.object({
  url: z.string().url('La URL del webhook no es válida').max(2048)
});

module.exports = { webhookRegisterSchema };
