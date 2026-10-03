const { AppError, wrap } = require('./errors');
const { createUserClient } = require('../services/databaseService');

// Verifies the Supabase access token and attaches a per-user DB client.
// That client sends the user's JWT, so Row Level Security applies to every query.
const requireUser = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new AppError(401, 'unauthenticated', 'Please sign in to continue.');

  const db = createUserClient(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new AppError(401, 'unauthenticated', 'Your session has expired. Please sign in again.');

  req.user = data.user;
  req.db = db;
  next();
});

module.exports = { requireUser };
