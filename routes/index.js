const express = require('express');
const { AppError, wrap } = require('../middleware/errors');
const { requireUser } = require('../middleware/auth');
const { getSpeechConfig } = require('../services/speechService');
const { LANGUAGES } = require('../services/learning');

const router = express.Router();

// Public: the Supabase URL and anon key are designed to be visible to the browser.
router.get('/config', wrap(async (req, res) => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new AppError(500, 'not_configured', 'The server is missing its Supabase settings. See the README, section "Environment variables".');
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    speech: getSpeechConfig(),
    languages: Object.entries(LANGUAGES).map(([code, l]) => ({ code, name: l.name, rtl: Boolean(l.rtl) })),
  });
}));


router.use('/guest', require('./guest')); // public: no login, nothing saved
router.use(requireUser);
router.use('/conversation', require('./conversation'));
router.use('/sessions', require('./sessions'));
router.use('/profile', require('./profile'));
router.use('/progress', require('./progress'));
router.use('/speech', require('./speech'));

router.delete('/history', wrap(async (req, res) => {
  await require('../services/databaseService').deleteAllHistory(req.db, req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
