const AttributeDefinition = require('../models/attributeDefinition.model');
const crud = require('../utils/crudController');

// La `key` la autogenera el modelo (snake_case desde el label); su unicidad la
// garantiza el índice único (409 DUPLICATE si se repite).
module.exports = crud(AttributeDefinition, { code: 'ATTRIBUTE', sort: { orden: 1, label: 1 } });
