const Badge = require('../models/badge.model');
const crud = require('../utils/crudController');

module.exports = crud(Badge, { afecta: 'badge', code: 'BADGE', slugFrom: 'nombre', sort: { orden: 1, nombre: 1 } });
