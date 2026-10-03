const express = require('express');
const { wrap } = require('../middleware/errors');
const dbs = require('../services/databaseService');
const { PRACTICE_HINTS } = require('../services/learning');

const router = express.Router();
const DAY = 86400000;

router.get('/', wrap(async (req, res) => {
  const [profile, progress] = await Promise.all([dbs.getProfile(req.db, req.user.id), dbs.getProgress(req.db)]);
  const weekAgo = Date.now() - 7 * DAY;
  const week = progress.activity.filter((s) => new Date(s.started_at).getTime() >= weekAgo);

  res.json({
    profile: {
      display_name: profile.display_name, level: profile.level, level_auto: profile.level_auto,
      native_language: profile.native_language,
    },
    totals: { sessions: progress.sessionCount, vocabulary: progress.vocabularyCount },
        latest_estimate: progress.activity.find((s) => s.estimated_level)?.estimated_level || null,
    week: { sessions: week.length, words: week.reduce((n, s) => n + (s.user_word_count || 0), 0) },
    activity: progress.activity.map((s) => ({ started_at: s.started_at, user_word_count: s.user_word_count })),
    recent: progress.activity.slice(0, 5),
    focus: progress.mistakes.map((m) => ({ ...m, hint: PRACTICE_HINTS[m.category] || PRACTICE_HINTS.grammar })),
    vocabulary: progress.vocabulary,
  });
}));

module.exports = router;
