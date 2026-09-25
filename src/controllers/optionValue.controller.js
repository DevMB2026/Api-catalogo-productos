const OptionValue = require('../models/optionValue.model');
const crud = require('../utils/crudController');

// Se filtra por ?option=<id> y se puebla la opción en las lecturas.
module.exports = crud(OptionValue, {
  afecta: 'optionValue', // productos que lo usan se marcan como cambiados al editarlo
  code: 'OPTION_VALUE',
  sort: { orden: 1, valor: 1 },
  populate: { path: 'option', select: 'nombre slug' },
  filters: ['option']
});
