const SizeChart = require('../models/sizeChart.model');
const crud = require('../utils/crudController');

module.exports = crud(SizeChart, { afecta: 'sizeChart', code: 'SIZE_CHART', slugFrom: 'nombre', sort: { nombre: 1 } });
