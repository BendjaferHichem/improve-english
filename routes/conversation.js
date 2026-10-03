const express = require('express');
const { AppError, wrap } = require('../middleware/errors');
const dbs = require('../services/databaseService');
const ai = require('../services/aiService');
const { pickScenario } = require('../services/scenarios');
const { MODES, SEVERITY_RANK, computeStats, nextLevel } = require('../services/learning');

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_MESSAGES = 12;      // conversation memory sent to the LLM each turn
const WEAKNESSES_PER_SESSION = 3;
const MAX_TRANSCRIPT_CHARS = 1000;
const REPORT_TRANSCRIPT_MESSAGES = 60;

const badSession = () => new AppError(400, 'bad_request', 'That conversation could not be found.');

// ---------- POST /api/conversation/start ----------
router.post('/start', wrap(async (req, res) => {
  const { db, user } = req;
  const { mode = 'casual', translate = false } = req.body || {};
  if (mode !== 'surprise' && !MODES.includes(mode)) throw new AppError(400, 'bad_request', 'Unknown conversation mode.');

  const [profile, weaknesses, recentTopics] = await Promise.all([
    dbs.getProfile(db, user.id),
    dbs.getTopMistakes(db, WEAKNESSES_PER_SESSION),
    dbs.getRecentTopics(db),
  ]);
  const scenario = pickScenario({ mode, level: profile.level, recentTopics, preferredModes: profile.preferred_modes });
  const opening = await ai.generateOpening({ profile, weaknesses, scenario, translate: Boolean(translate) });

  // Snapshot what the LLM needs, so each turn avoids extra database reads.
  const session = await dbs.createSession(db, {
    user_id: user.id,
    mode: scenario.mode,
    topic: scenario.title,
    level: profile.level,
    context: {
      scenario,
      weaknesses: weaknesses.map(({ category, pattern, frequency }) => ({ category, pattern, frequency })),
      correction_level: profile.correction_level,
      native_language: profile.native_language,
    },
  });
  await dbs.addMessages(db, [{
    session_id: session.id, user_id: user.id, speaker: 'ai', transcript: opening.reply, translation: opening.translation,
  }]);

  res.json({
    sessionId: session.id, mode: scenario.mode, title: scenario.title, level: profile.level,
    opening: { text: opening.reply, translation: opening.translation },
  });
}));

// ---------- POST /api/conversation/message ----------
router.post('/message', wrap(async (req, res) => {
  const { db, user } = req;
  const { sessionId, translate = false } = req.body || {};
  const transcript = String(req.body?.transcript || '').trim().replace(/\s+/g, ' ');
  const speechMs = Math.max(0, Math.min(Math.round(Number(req.body?.speechMs) || 0), 10 * 60 * 1000));

  if (!UUID.test(sessionId || '')) throw badSession();
  if (!transcript) throw new AppError(400, 'empty_transcript', "We didn't catch any words. Please try speaking again.");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) throw new AppError(400, 'too_long', 'That was a lot at once. Try a shorter answer.');

  const [session, recent] = await Promise.all([
    dbs.getSession(db, sessionId),
    dbs.getRecentMessages(db, sessionId, RECENT_MESSAGES),
  ]);
  if (session.ended_at) throw new AppError(409, 'session_ended', 'This conversation has already ended.');

  const lastAi = [...recent].reverse().find((m) => m.speaker === 'ai');
  const ctx = session.context || {};
  const turn = await ai.respond({
    context: {
      level: session.level, nativeLanguage: ctx.native_language, correctionLevel: ctx.correction_level,
      weaknesses: ctx.weaknesses, scenario: ctx.scenario, lastCorrected: Boolean(lastAi?.correction_shown),
    },
    recent,
    transcript,
    translate: Boolean(translate),
  });

  // Saving is best-effort: a database hiccup should not cost the learner their reply.
  let correction = null;
  try {
    const rows = await dbs.addMessages(db, [
      // Both rows must list the same fields: the database library sends a missing field as NULL,
      // which breaks NOT NULL columns such as correction_shown.
      { session_id: sessionId, user_id: user.id, speaker: 'user', transcript, translation: null, speech_ms: speechMs || null, correction_shown: false },
      { session_id: sessionId, user_id: user.id, speaker: 'ai', transcript: turn.reply, translation: turn.translation, speech_ms: null, correction_shown: turn.shouldCorrect },
    ]);
    if (turn.corrections.length) {
      const userMessage = rows.find((r) => r.speaker === 'user');
      const frequencies = await dbs.recordMistakes(db, user.id, turn.corrections);
      await dbs.addCorrections(db, turn.corrections.map((c, i) => ({
        message_id: userMessage.id, session_id: sessionId, user_id: user.id,
        original_text: c.original, corrected_text: c.corrected, explanation: c.explanation,
        category: c.category, pattern: c.pattern, severity: c.severity, shown_to_user: i === 0 && turn.shouldCorrect,
      })));
      if (turn.shouldCorrect) {
        const c = turn.corrections[0];
        const explain = SEVERITY_RANK[c.severity] >= SEVERITY_RANK.important || frequencies[0] >= 3;
        correction = { original: c.original, corrected: c.corrected, explanation: explain ? c.explanation : '' };
      }
    }
  } catch (err) {
    console.error('Could not save turn:', err.message);
  }

  res.json({ reply: turn.reply, translation: turn.translation, correction });
}));

// ---------- POST /api/conversation/translate ----------
router.post('/translate', wrap(async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 900);
  if (!text) throw new AppError(400, 'bad_request', 'Nothing to translate.');
  const profile = await dbs.getProfile(req.db, req.user.id);
  res.json({ translation: await ai.translate(text, profile.native_language) });
}));

// ---------- POST /api/conversation/end ----------
router.post('/end', wrap(async (req, res) => {
  const { db, user } = req;
  const { sessionId, skipAi = false } = req.body || {};
  if (!UUID.test(sessionId || '')) throw badSession();

  const session = await dbs.getSession(db, sessionId);
  if (session.ended_at && session.report) return res.json(endPayload(session, session.report));

  const [messages, corrections] = await Promise.all([
    dbs.getSessionMessages(db, sessionId),
    dbs.getSessionCorrections(db, sessionId),
  ]);
  const stats = computeStats(messages);

  // Real data first: the most useful mistakes and the patterns that keep coming back.
  const mistakes = [...corrections]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, 5)
    .map((c) => ({ original: c.original_text, corrected: c.corrected_text, explanation: c.explanation, category: c.category }));
  const patterns = [...new Set(corrections.map((c) => c.pattern))];
  const recurring = (await dbs.getMistakesByPatterns(db, patterns))
    .filter((m) => m.frequency >= 2).sort((a, b) => b.frequency - a.frequency).slice(0, 4);

  let report = { ai_available: false, summary: null, performance: null, participation_note: null, new_expressions: [], suggestions: [], estimated_level: null };

  if (stats.user_turns === 0) {
    report.summary = 'You ended the conversation before speaking, so there is nothing to review yet.';
  } else if (!skipAi) {
    const generated = await ai.generateReport({
            mode: session.mode, topic: session.topic, stats,
      corrections_by_category: countBy(corrections, 'category'),
      transcript: messages.slice(-REPORT_TRANSCRIPT_MESSAGES).map((m) => ({ who: m.speaker === 'ai' ? 'maya' : 'learner', text: m.transcript.slice(0, 300) })),
    });
    report = { ai_available: true, ...generated };
  }

  report = { ...report, mistakes, recurring_patterns: recurring, stats };
  const updated = await dbs.updateSession(db, sessionId, {
    ended_at: new Date().toISOString(),
    estimated_level: report.estimated_level,
    user_word_count: stats.user_words,
    report,
  });

  // Learning state: vocabulary and (gradual) level adjustment.
  try {
    await dbs.upsertVocabulary(db, user.id, sessionId, report.new_expressions);
    if (report.estimated_level) {
      const profile = await dbs.getProfile(db, user.id);
      if (profile.level_auto) {
        const level = nextLevel(profile.level, await dbs.getRecentEstimates(db, 2));
        if (level !== profile.level) await dbs.updateProfile(db, user.id, { level });
      }
    }
  } catch (err) {
    console.error('Could not update learning state:', err.message);
  }

  res.json(endPayload(updated, report));
}));

function endPayload(session, report) {
  const { id, mode, topic, level, started_at, ended_at, estimated_level } = session;
  return { session: { id, mode, topic, level, started_at, ended_at, estimated_level }, report };
}

function countBy(rows, key) {
  return rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
}

module.exports = router;
