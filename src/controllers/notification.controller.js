const Notification = require('../models/notification.model');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/v1/notificaciones (admin) — historial más reciente primero.
exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const notificaciones = await Notification.find().sort({ createdAt: -1 }).limit(limit);
  res.json({ success: true, data: notificaciones });
});
