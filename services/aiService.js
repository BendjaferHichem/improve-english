// LLM abstraction. The rest of the app only calls respond / generateOpening /
// generateReport / translate. To add a provider, add one function to `providers`.
const { AppError } = require('../middleware/errors');
const prompts = require('./prompts');
const { CATEGORIES, SEVERITIES, LEVELS, LANGUAGES } = require('./learning');

const TIMEOUT_MS = 22000;

// ---------- providers: (opts) => Promise<string of JSON text> ----------

const providers = {
  async gemini({ apiKey, model, system, messages, temperature, maxTokens, signal }) {
    const generationConfig = { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' };
    const budget = process.env.AI_GEMINI_THINKING_BUDGET;
    if (budget !== undefined && budget !== '') generationConfig.thinkingConfig = { thinkingBudget: Number(budget) };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig,
        }),
      },
    );
    const body = await readBody(res);
    if (!res.ok) throw httpError(res.status, body);
    return body.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  },

  // Groq, OpenRouter, and anything else that speaks the OpenAI chat-completions format.
  async 'openai-compatible'({ apiKey, model, system, messages, temperature, maxTokens, signal, defaultBaseUrl }) {
    const baseUrl = (process.env.AI_BASE_URL || defaultBaseUrl || '').replace(/\/$/, '');
    if (!baseUrl) throw new AppError(503, 'ai_config', 'The AI service is not configured (AI_BASE_URL is missing).');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    const body = await readBody(res);
    if (!res.ok) throw httpError(res.status, body);
    return body.choices?.[0]?.message?.content || '';
  },
};

// Named shortcuts for OpenAI-compatible services: same code, preset address.
const PRESETS = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};
for (const [name, url] of Object.entries(PRESETS)) {
  providers[name] = (opts) => providers['openai-compatible']({ ...opts, defaultBaseUrl: url });
}

async function readBody(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function httpError(status, body) {
  console.error('AI provider error', status, JSON.stringify(body).slice(0, 400));
  if (status === 429) return new AppError(429, 'ai_rate_limited', 'The AI is a little busy right now. Wait a few seconds and try again.');
  if (status === 401 || status === 403) return new AppError(503, 'ai_auth', 'The AI service rejected its credentials. The server owner needs to check AI_API_KEY.');
  if (status === 400 || status === 404) return new AppError(503, 'ai_config', "The configured AI model isn't available. The server owner needs to check AI_MODEL.");
  return new AppError(502, 'ai_unavailable', 'The AI service is not responding right now. Please try again in a moment.');
}

// ---------- core call ----------

// Providers want alternating roles starting with "user".
function sanitize(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += ' ' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: '(The conversation has just started.)' });
  return out;
}

async function complete({ system, messages, temperature = 0.9, maxTokens = 900 }) {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || 'gemini-2.5-flash';
  if (!providers[provider]) throw new AppError(503, 'ai_config', `Unknown AI_PROVIDER "${provider}".`);
  if (!apiKey) throw new AppError(503, 'ai_not_configured', "The AI service isn't set up yet. The server owner needs to add AI_API_KEY.");

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const text = await providers[provider]({
        apiKey, model, system, messages: sanitize(messages), temperature, maxTokens, signal: controller.signal,
      });
      return parseJson(text);
    } catch (err) {
      const retryable = err.name === 'AbortError' || err.code === 'ai_unavailable' || err instanceof TypeError;
      if (attempt === 0 && retryable) continue;
      if (err instanceof AppError) throw err;
      if (err.name === 'AbortError') throw new AppError(504, 'ai_timeout', 'The AI took too long to answer. Please try again.');
      console.error('AI network error', err);
      throw new AppError(502, 'ai_unavailable', "We couldn't reach the AI service. Please try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch { /* fall through */ } }
  console.error('Unparseable AI output:', cleaned.slice(0, 300));
  throw new AppError(502, 'ai_bad_response', 'The AI gave an unexpected answer. Please try again.');
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- public API ----------

function promptContext({ level, nativeLanguage, correctionLevel, weaknesses, scenario, lastCorrected, translate }) {
  return { level, nativeLanguage, correctionLevel, weaknesses, scenario, lastCorrected, translate };
}

async function generateOpening({ profile, weaknesses, scenario, translate }) {
  const system = prompts.openingSystem(promptContext({
    level: profile.level, nativeLanguage: profile.native_language, correctionLevel: profile.correction_level,
    weaknesses, scenario, translate,
  }));
  const data = await complete({ system, messages: [{ role: 'user', content: '(start)' }], maxTokens: 400 });
  const reply = str(data.reply, 500);
  if (!reply) throw new AppError(502, 'ai_bad_response', 'The AI gave an unexpected answer. Please try again.');
  return { reply, translation: translate ? str(data.reply_translation, 700) || null : null };
}

async function respond({ context, recent, transcript, translate }) {
  const system = prompts.turnSystem(promptContext({ ...context, translate }));
  const messages = [
    ...recent.map((m) => ({ role: m.speaker === 'ai' ? 'assistant' : 'user', content: m.transcript })),
    { role: 'user', content: transcript },
  ];
  const data = await complete({ system, messages, maxTokens: 900 });
  return normalizeTurn(data, translate);
}

function normalizeTurn(data, translate) {
  const reply = str(data.reply, 700);
  if (!reply) throw new AppError(502, 'ai_bad_response', 'The AI gave an unexpected answer. Please try again.');
  const analysis = data.analysis || {};
  const corrections = (Array.isArray(analysis.corrections) ? analysis.corrections : [])
    .slice(0, 3)
    .map((c) => ({
      original: str(c.original, 200),
      corrected: str(c.corrected, 200),
      explanation: str(c.explanation, 300),
      category: CATEGORIES.includes(c.category) ? c.category : 'grammar',
      pattern: str(c.pattern, 80).toLowerCase() || 'general',
      severity: SEVERITIES.includes(c.severity) ? c.severity : 'minor',
    }))
    .filter((c) => c.original && c.corrected && c.original.toLowerCase() !== c.corrected.toLowerCase());

  return {
    reply,
    translation: translate ? str(data.reply_translation, 900) || null : null,
    corrections,
    shouldCorrect: Boolean(analysis.should_correct_now) && corrections.length > 0,
  };
}

async function generateReport(payload) {
  const data = await complete({
    system: prompts.REPORT_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    temperature: 0.4,
    maxTokens: 1200,
  });
  const score = (p) => ({ score: Math.min(5, Math.max(1, Math.round(Number(p?.score) || 3))), note: str(p?.note, 220) });
  const perf = data.performance || {};
  return {
    summary: str(data.summary, 500),
    performance: {
      fluency: score(perf.fluency), vocabulary: score(perf.vocabulary),
      grammar: score(perf.grammar), naturalness: score(perf.naturalness),
    },
    participation_note: str(data.participation_note, 220),
    new_expressions: (Array.isArray(data.new_expressions) ? data.new_expressions : []).slice(0, 5)
      .map((e) => ({ phrase: str(e.phrase, 80), meaning: str(e.meaning, 160), example: str(e.example, 200) }))
      .filter((e) => e.phrase),
    suggestions: (Array.isArray(data.suggestions) ? data.suggestions : []).slice(0, 4).map((s) => str(s, 240)).filter(Boolean),
    estimated_level: LEVELS.includes(data.estimated_level) ? data.estimated_level : null,
  };
}

async function translate(text, languageCode) {
  const language = LANGUAGES[languageCode]?.name;
  if (!language) throw new AppError(400, 'bad_request', 'Unsupported translation language.');
  const data = await complete({
    system: prompts.TRANSLATE_SYSTEM(language),
    messages: [{ role: 'user', content: text }],
    temperature: 0.2,
    maxTokens: 500,
  });
  return str(data.translation, 900) || null;
}

module.exports = { generateOpening, respond, generateReport, translate };
