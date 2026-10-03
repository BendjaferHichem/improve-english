const express = require('express');
const { AppError, wrap } = require('../middleware/errors');
const dbs = require('../services/databaseService');
const { LEVELS, MODES, CORRECTION_LEVELS, LANGUAGES } = require('../services/learning');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  res.json({ profile: await dbs.getProfile(req.db, req.user.id) });
}));

const bad = (msg) => new AppError(400, 'bad_request', msg);

router.patch('/', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};

  if ('display_name' in b) patch.display_name = String(b.display_name || '').trim().slice(0, 40) || null;
  if ('native_language' in b) {
    if (!LANGUAGES[b.native_language]) throw bad('Unsupported native language.');
    patch.native_language = b.native_language;
  }
  if ('level' in b) {
    if (!LEVELS.includes(b.level)) throw bad('Unknown English level.');
    patch.level = b.level;
  }
  if ('level_auto' in b) patch.level_auto = Boolean(b.level_auto);
  if ('ai_voice' in b) patch.ai_voice = b.ai_voice ? String(b.ai_voice).slice(0, 200) : null;
  if ('speech_rate' in b) {
    const rate = Number(b.speech_rate);
    if (!(rate >= 0.6 && rate <= 1.3)) throw bad('Speaking speed must be between 0.6 and 1.3.');
    patch.speech_rate = rate;
  }
  if ('correction_level' in b) {
    if (!CORRECTION_LEVELS.includes(b.correction_level)) throw bad('Unknown correction intensity.');
    patch.correction_level = b.correction_level;
  }
  if ('translation_enabled' in b) patch.translation_enabled = Boolean(b.translation_enabled);
  if ('preferred_modes' in b) {
    if (!Array.isArray(b.preferred_modes) || b.preferred_modes.some((m) => !MODES.includes(m))) throw bad('Unknown conversation mode.');
    patch.preferred_modes = b.preferred_modes;
  }

  res.json({ profile: await dbs.updateProfile(req.db, req.user.id, patch) });
}));

module.exports = router;
