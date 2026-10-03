// Guest mode: public endpoints that never touch the database.
// The browser keeps the conversation and sends what is needed with each request.
const express = require('express');
const { AppError, wrap } = require('../middleware/errors');
const ai = require('../services/aiService');
const { pickScenario } = require('../services/scenarios');
const {
  MODES, LEVELS, LANGUAGES, CATEGORIES, SEVERITIES, SEVERITY_RANK, computeStats,
} = require('../services/learning');

const router = express.Router();

const RECENT_MESSAGES = 12;
const MAX_HISTORY = 60;

// ---- abuse guard: these routes spend your AI quota without a login ----
// In-memory, so on Vercel it is per server instance: a speed bump, not a guarantee.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 60;
const hits = new Map();

router.use((req, res, next) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    return next(new AppError(429, 'guest_rate_limited', 'Guest mode is limited for now. Please wait a few minutes, or create a free account.'));
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
  }
  return next();
});

// ---- input cleaning: never trust what the browser sends back ----
const clean = (value, max = 1000) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const bad = (message) => new AppError(400, 'bad_request', message);

function cleanContext(ctx = {}) {
  const s = ctx.scenario || {};
  return {
    level: LEVELS.includes(ctx.level) ? ctx.level : 'B1',
    native_language: LANGUAGES[ctx.native_language] ? ctx.native_language : 'ar',
    scenario: {
      mode: MODES.includes(s.mode) ? s.mode : 'casual',
      title: clean(s.title, 120), brief: clean(s.brief, 400),
      aiRole: clean(s.aiRole, 80) || undefined, userRole: clean(s.userRole, 80) || undefined,
    },
  };
}

function cleanHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-MAX_HISTORY).map((m) => ({
    speaker: m?.speaker === 'ai' ? 'ai' : 'user',
    transcript: clean(m?.transcript, 700),
    speech_ms: Math.max(0, Math.min(Math.round(Number(m?.speech_ms) || 0), 600000)),
    correction_shown: Boolean(m?.correction_shown),
  })).filter((m) => m.transcript);
}

function cleanCorrections(list) {
  return (Array.isArray(list) ? list : []).slice(0, 100).map((c) => ({
    original: clean(c?.original, 200), corrected: clean(c?.corrected, 200), explanation: clean(c?.explanation, 300),
    category: CATEGORIES.includes(c?.category) ? c.category : 'grammar',
    pattern: clean(c?.pattern, 80).toLowerCase() || 'general',
    severity: SEVERITIES.includes(c?.severity) ? c.severity : 'minor',
  })).filter((c) => c.original && c.corrected);
}

// ---------- POST /api/guest/start ----------
router.post('/start', wrap(async (req, res) => {
  const { mode = 'casual', translate = false } = req.body || {};
  const level = LEVELS.includes(req.body?.level) ? req.body.level : 'B1';
  if (mode !== 'surprise' && !MODES.includes(mode)) throw bad('Unknown conversation mode.');

  const scenario = pickScenario({ mode, level });
  const profile = { level, native_language: 'ar', correction_level: 'normal' };
  const opening = await ai.generateOpening({ profile, weaknesses: [], scenario, translate: Boolean(translate) });

  res.json({
    level, mode: scenario.mode, title: scenario.title,
    context: { level, native_language: 'ar', scenario },
    opening: { text: opening.reply, translation: opening.translation },
  });
}));

// ---------- POST /api/guest/message ----------
router.post('/message', wrap(async (req, res) => {
  const transcript = clean(req.body?.transcript);
  if (!transcript) throw new AppError(400, 'empty_transcript', "We didn't catch any words. Please try speaking again.");

  const ctx = cleanContext(req.body?.context);
  const recent = cleanHistory(req.body?.history).slice(-RECENT_MESSAGES);
  const lastAi = [...recent].reverse().find((m) => m.speaker === 'ai');

  const turn = await ai.respond({
    context: {
      level: ctx.level, nativeLanguage: ctx.native_language, correctionLevel: 'normal',
      weaknesses: [], scenario: ctx.scenario, lastCorrected: Boolean(lastAi?.correction_shown),
    },
    recent,
    transcript,
    translate: Boolean(req.body?.translate),
  });

  let correction = null;
  if (turn.shouldCorrect) {
    const c = turn.corrections[0];
    const explain = SEVERITY_RANK[c.severity] >= SEVERITY_RANK.important;
    correction = { original: c.original, corrected: c.corrected, explanation: explain ? c.explanation : '' };
  }
  // `corrections` goes back to the browser, which keeps them for the end-of-session review.
  res.json({ reply: turn.reply, translation: turn.translation, correction, corrections: turn.corrections });
}));

// ---------- POST /api/guest/translate ----------
router.post('/translate', wrap(async (req, res) => {
  const text = clean(req.body?.text, 900);
  if (!text) throw bad('Nothing to translate.');
  const language = LANGUAGES[req.body?.language] ? req.body.language : 'ar';
  res.json({ translation: await ai.translate(text, language) });
}));

// ---------- POST /api/guest/end ----------
router.post('/end', wrap(async (req, res) => {
  const level = LEVELS.includes(req.body?.level) ? req.body.level : 'B1';
  const mode = MODES.includes(req.body?.mode) ? req.body.mode : 'casual';
  const topic = clean(req.body?.topic, 120);
  const messages = cleanHistory(req.body?.history);
  const corrections = cleanCorrections(req.body?.corrections);
  const startedAt = new Date(req.body?.startedAt);
  const stats = computeStats(messages);

  const mistakes = [...corrections]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, 5)
    .map((c) => ({ original: c.original, corrected: c.corrected, explanation: c.explanation, category: c.category }));

  // No history across sessions in guest mode, so "recurring" means repeated within this chat.
  const groups = new Map();
  for (const c of corrections) {
    const key = `${c.category}::${c.pattern}`;
    const group = groups.get(key) || { category: c.category, pattern: c.pattern, frequency: 0, example_original: c.original, example_corrected: c.corrected };
    group.frequency += 1;
    groups.set(key, group);
  }
  const recurring = [...groups.values()].filter((g) => g.frequency >= 2).sort((a, b) => b.frequency - a.frequency).slice(0, 4);

  let report = { ai_available: false, summary: null, performance: null, participation_note: null, new_expressions: [], suggestions: [], estimated_level: null };
  if (stats.user_turns === 0) {
    report.summary = 'You ended the conversation before speaking, so there is nothing to review yet.';
  } else if (!req.body?.skipAi) {
    const byCategory = corrections.reduce((acc, c) => ({ ...acc, [c.category]: (acc[c.category] || 0) + 1 }), {});
    const generated = await ai.generateReport({
      mode, topic, stats, corrections_by_category: byCategory,
      transcript: messages.map((m) => ({ who: m.speaker === 'ai' ? 'maya' : 'learner', text: m.transcript.slice(0, 300) })),
    });
    report = { ai_available: true, ...generated };
  }

  res.json({
    session: { mode, topic, level, started_at: (Number.isNaN(startedAt.getTime()) ? new Date() : startedAt).toISOString() },
    report: { ...report, mistakes, recurring_patterns: recurring, stats },
  });
}));

module.exports = router;