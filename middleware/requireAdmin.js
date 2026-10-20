// Use after authenticate. The role comes from the database row that
// authenticate loaded, never from the token or the request.
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
};

module.exports = { requireAdmin };
