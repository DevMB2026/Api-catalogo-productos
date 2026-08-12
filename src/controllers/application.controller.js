const Application = require('../models/application.model');
const crud = require('../utils/crudController');

module.exports = crud(Application, { code: 'APPLICATION', slugFrom: 'nombre', sort: { nombre: 1 } });
