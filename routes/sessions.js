const express = require('express');
const { AppError, wrap } = require('../middleware/errors');
const dbs = require('../services/databaseService');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/', wrap(async (req, res) => {
  res.json({ sessions: await dbs.listSessions(req.db, 30) });
}));

router.get('/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new AppError(404, 'not_found', 'That conversation could not be found.');
  const session = await dbs.getSession(req.db, req.params.id);
  const [messages, corrections] = await Promise.all([
    dbs.getSessionMessages(req.db, session.id),
    dbs.getSessionCorrections(req.db, session.id),
  ]);
  const byMessage = {};
  for (const c of corrections) (byMessage[c.message_id] ||= []).push(c);

  const { context, report, ...meta } = session;
  res.json({
    session: meta,
    report,
    messages: messages.map((m) => ({
      speaker: m.speaker, transcript: m.transcript, translation: m.translation,
      corrections: (byMessage[m.id] || []).map((c) => ({
        original: c.original_text, corrected: c.corrected_text, explanation: c.explanation, category: c.category, shown: c.shown_to_user,
      })),
    })),
  });
}));

module.exports = router;
