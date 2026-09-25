const Feature = require('../models/feature.model');
const crud = require('../utils/crudController');

module.exports = crud(Feature, { afecta: 'feature', code: 'FEATURE', slugFrom: 'nombre', sort: { orden: 1, nombre: 1 } });
