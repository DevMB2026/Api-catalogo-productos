const Option = require('../models/option.model');
const crud = require('../utils/crudController');

module.exports = crud(Option, { code: 'OPTION', slugFrom: 'nombre', sort: { orden: 1, nombre: 1 } });
