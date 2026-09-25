const Option = require('../models/option.model');
const crud = require('../utils/crudController');

module.exports = crud(Option, { afecta: 'option', code: 'OPTION', slugFrom: 'nombre', sort: { orden: 1, nombre: 1 } });
