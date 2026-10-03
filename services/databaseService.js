// All Supabase access lives here. Every function takes a per-user client (`db`),
// so Row Level Security enforces ownership even if a route forgets a filter.
const { createClient } = require('@supabase/supabase-js');
const { AppError } = require('../middleware/errors');

function createUserClient(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new AppError(500, 'not_configured', 'The server is missing its Supabase settings.');
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function ok({ data, error }, what) {
  if (error) {
    console.error(`DB error (${what}):`, error.message);
    throw new AppError(500, 'db_error', "We couldn't reach your learning data. Please try again in a moment.");
  }
  return data;
}

const now = () => new Date().toISOString();

// ---- profile ----
async function getProfile(db, userId) {
  const existing = ok(await db.from('profiles').select('*').eq('id', userId).maybeSingle(), 'get profile');
  if (existing) return existing;
  return ok(await db.from('profiles').insert({ id: userId }).select('*').single(), 'create profile');
}

async function updateProfile(db, userId, patch) {
  await getProfile(db, userId);
  return ok(await db.from('profiles').update({ ...patch, updated_at: now() }).eq('id', userId).select('*').single(), 'update profile');
}

// ---- sessions ----
async function createSession(db, row) {
  return ok(await db.from('sessions').insert(row).select('*').single(), 'create session');
}

async function getSession(db, id) {
  const data = ok(await db.from('sessions').select('*').eq('id', id).maybeSingle(), 'get session');
  if (!data) throw new AppError(404, 'not_found', 'That conversation could not be found.');
  return data;
}

async function updateSession(db, id, patch) {
  return ok(await db.from('sessions').update(patch).eq('id', id).select('*').single(), 'update session');
}

async function listSessions(db, limit = 30) {
  return ok(await db.from('sessions')
    .select('id,started_at,ended_at,mode,topic,level,estimated_level,user_word_count')
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false }).limit(limit), 'list sessions');
}

async function getRecentTopics(db, limit = 6) {
  const rows = ok(await db.from('sessions').select('topic').order('started_at', { ascending: false }).limit(limit), 'recent topics');
  return rows.map((r) => r.topic).filter(Boolean);
}

async function getRecentEstimates(db, limit = 2) {
  const rows = ok(await db.from('sessions').select('estimated_level')
    .not('estimated_level', 'is', null).order('ended_at', { ascending: false }).limit(limit), 'recent estimates');
  return rows.map((r) => r.estimated_level);
}

// ---- messages & corrections ----
async function addMessages(db, rows) {
  return ok(await db.from('messages').insert(rows).select('id,speaker'), 'add messages');
}

async function getRecentMessages(db, sessionId, limit) {
  const rows = ok(await db.from('messages').select('speaker,transcript,correction_shown')
    .eq('session_id', sessionId).order('seq', { ascending: false }).limit(limit), 'recent messages');
  return rows.reverse();
}

async function getSessionMessages(db, sessionId, limit = 400) {
  return ok(await db.from('messages').select('id,speaker,transcript,translation,speech_ms,created_at')
    .eq('session_id', sessionId).order('seq', { ascending: true }).limit(limit), 'session messages');
}

async function addCorrections(db, rows) {
  if (!rows.length) return;
  ok(await db.from('corrections').insert(rows), 'add corrections');
}

async function getSessionCorrections(db, sessionId) {
  return ok(await db.from('corrections')
    .select('message_id,original_text,corrected_text,explanation,category,pattern,severity,shown_to_user')
    .eq('session_id', sessionId), 'session corrections');
}

// ---- mistakes (recurring patterns) ----
// Returns the running frequency for each correction, in order.
async function recordMistakes(db, userId, corrections) {
  const seen = new Map();
  const frequencies = [];
  for (const c of corrections) {
    const key = `${c.category}::${c.pattern}`;
    if (!seen.has(key)) {
      const row = ok(await db.from('mistakes').select('id,frequency')
        .eq('user_id', userId).eq('category', c.category).eq('pattern', c.pattern).maybeSingle(), 'find mistake');
      const example = { example_original: c.original, example_corrected: c.corrected, last_seen: now() };
      if (row) {
        ok(await db.from('mistakes').update({ ...example, frequency: row.frequency + 1 }).eq('id', row.id), 'update mistake');
        seen.set(key, row.frequency + 1);
      } else {
        ok(await db.from('mistakes').insert({ user_id: userId, category: c.category, pattern: c.pattern, ...example }), 'insert mistake');
        seen.set(key, 1);
      }
    }
    frequencies.push(seen.get(key));
  }
  return frequencies;
}

async function getTopMistakes(db, limit = 5) {
  return ok(await db.from('mistakes')
    .select('category,pattern,frequency,last_seen,example_original,example_corrected')
    .order('frequency', { ascending: false }).order('last_seen', { ascending: false }).limit(limit), 'top mistakes');
}

async function getMistakesByPatterns(db, patterns) {
  if (!patterns.length) return [];
  return ok(await db.from('mistakes')
    .select('category,pattern,frequency,example_original,example_corrected')
    .in('pattern', patterns), 'mistakes by pattern');
}

// ---- vocabulary ----
async function upsertVocabulary(db, userId, sessionId, items) {
  if (!items.length) return;
  const existing = ok(await db.from('vocabulary').select('id,phrase,times_seen')
    .in('phrase', items.map((i) => i.phrase)), 'find vocabulary');
  const byPhrase = new Map(existing.map((r) => [r.phrase, r]));
  const fresh = [];
  for (const item of items) {
    const row = byPhrase.get(item.phrase);
    if (row) ok(await db.from('vocabulary').update({ times_seen: row.times_seen + 1 }).eq('id', row.id), 'update vocabulary');
    else fresh.push({ user_id: userId, session_id: sessionId, phrase: item.phrase, meaning: item.meaning, example: item.example });
  }
  if (fresh.length) ok(await db.from('vocabulary').insert(fresh), 'insert vocabulary');
}

// ---- progress ----
async function getProgress(db) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [activity, sessionCount, mistakes, vocab] = await Promise.all([
    db.from('sessions').select('id,started_at,mode,topic,estimated_level,user_word_count')
      .not('ended_at', 'is', null).gte('started_at', since).order('started_at', { ascending: false }).limit(100),
    db.from('sessions').select('id', { count: 'exact', head: true }).not('ended_at', 'is', null),
    getTopMistakes(db, 5),
    db.from('vocabulary').select('phrase,meaning', { count: 'exact' }).order('first_seen', { ascending: false }).limit(12),
  ]);
  return {
    activity: ok(activity, 'progress activity'),
    sessionCount: sessionCount.count || 0,
    mistakes,
    vocabulary: ok(vocab, 'progress vocabulary'),
    vocabularyCount: vocab.count || 0,
  };
}

// ---- privacy ----
// Deleting sessions cascades to messages and corrections.
async function deleteAllHistory(db, userId) {
  ok(await db.from('sessions').delete().eq('user_id', userId), 'delete sessions');
  ok(await db.from('mistakes').delete().eq('user_id', userId), 'delete mistakes');
  ok(await db.from('vocabulary').delete().eq('user_id', userId), 'delete vocabulary');
}

module.exports = {
  createUserClient, getProfile, updateProfile, createSession, getSession, updateSession, listSessions,
  getRecentTopics, getRecentEstimates, addMessages, getRecentMessages, getSessionMessages, addCorrections,
  getSessionCorrections, recordMistakes, getTopMistakes, getMistakesByPatterns, upsertVocabulary,
  getProgress, deleteAllHistory,
};
