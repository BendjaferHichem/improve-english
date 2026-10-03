// Pure learning-domain helpers: levels, categories, stats. No I/O.

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const MODES = ['casual', 'random', 'story', 'travel', 'roleplay', 'debate', 'scenario'];

// Pronunciation and spelling are deliberately absent: browser speech recognition returns
// text only, so neither can be judged honestly.
const CATEGORIES = [
  'grammar', 'verb_tense', 'articles', 'prepositions', 'word_order', 'vocabulary',
  'sentence_structure', 'unnatural_phrasing', 'word_choice', 'agreement',
  'pluralization', 'contractions', 'fluency',
];

const SEVERITIES = ['minor', 'useful', 'important', 'blocking'];
const SEVERITY_RANK = { minor: 0, useful: 1, important: 2, blocking: 3 };

const CORRECTION_LEVELS = ['light', 'normal', 'strict'];

const LANGUAGES = {
  ar: { name: 'Arabic', rtl: true },
  fr: { name: 'French' },
  es: { name: 'Spanish' },
  tr: { name: 'Turkish' },
  fa: { name: 'Persian', rtl: true },
  ur: { name: 'Urdu', rtl: true },
  hi: { name: 'Hindi' },
  pt: { name: 'Portuguese' },
  zh: { name: 'Chinese' },
  ru: { name: 'Russian' },
};

const LEVEL_GUIDE = {
  A1: { style: 'Very short sentences (under 10 words), only very common words, simple present tense, one simple question at a time.', length: '1 short sentence, 2 at most (about 15 words)' },
  A2: { style: 'Short sentences (under 15 words), everyday vocabulary, simple past and future, concrete questions about daily life.', length: '1-2 short sentences (about 20 words)' },
  B1: { style: 'Everyday vocabulary, moderate sentence length, a few phrasal verbs, questions about experiences, plans and opinions.', length: '1-3 sentences (about 35 words)' },
  B2: { style: 'Broader vocabulary, occasional idioms, abstract and hypothetical questions, and you expect fuller answers.', length: '2-3 sentences (about 45 words)' },
  C1: { style: 'Nuanced discussion, less common vocabulary, idioms, subtle distinctions; challenge their reasoning.', length: 'up to 4 sentences (about 60 words)' },
  C2: { style: 'Near-native register, irony, wordplay and complex argument; do not simplify anything.', length: 'up to 4 sentences (about 60 words)' },
};

// Conversation nudges that make a weak area come up naturally, without announcing a lesson.
const PRACTICE_HINTS = {
  verb_tense: 'ask about things that already happened: yesterday, last weekend, a memorable trip',
  articles: 'ask them to describe specific places and things, like the café near their house',
  prepositions: 'ask where and when things happen and how they get places',
  word_order: 'invite them to ask you questions and to explain how something works',
  vocabulary: 'go deeper into topics they care about so they need more precise words',
  sentence_structure: 'ask "why" and "what happened next" to encourage longer connected sentences',
  unnatural_phrasing: 'ask for opinions and reactions to short stories',
  word_choice: 'ask them to describe feelings and experiences in detail',
  agreement: "ask about other people's routines, like what their brother does on weekends",
  pluralization: 'ask about groups of things: how many, which ones, what kinds',
  contractions: 'keep the chat casual and quick-paced',
  grammar: 'keep the conversation flowing with open questions',
  fluency: 'ask open questions that need a few sentences to answer',
};

const levelIndex = (level) => Math.max(0, LEVELS.indexOf(level));

// Move the stored level at most one step, and only when the last two sessions agree.
function nextLevel(current, recentEstimates) {
  if (recentEstimates.length < 2) return current;
  const i = levelIndex(current);
  const [a, b] = recentEstimates.map(levelIndex);
  if (a > i && b > i) return LEVELS[Math.min(i + 1, LEVELS.length - 1)];
  if (a < i && b < i) return LEVELS[Math.max(i - 1, 0)];
  return current;
}

const words = (text) => text.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);

// Real, measured numbers (not AI estimates).
function computeStats(messages) {
  const user = messages.filter((m) => m.speaker === 'user');
  const ai = messages.filter((m) => m.speaker === 'ai');
  const userWords = user.reduce((n, m) => n + words(m.transcript).length, 0);
  const aiWords = ai.reduce((n, m) => n + words(m.transcript).length, 0);
  const distinct = new Set(user.flatMap((m) => words(m.transcript))).size;

  const timed = user.filter((m) => m.speech_ms > 0);
  const timedWords = timed.reduce((n, m) => n + words(m.transcript).length, 0);
  const timedMs = timed.reduce((n, m) => n + m.speech_ms, 0);
  const wpm = timedWords >= 20 && timedMs > 0 ? Math.round(timedWords / (timedMs / 60000)) : null;

  return {
    user_turns: user.length,
    ai_turns: ai.length,
    user_words: userWords,
    ai_words: aiWords,
    talk_share: userWords + aiWords ? Math.round((userWords / (userWords + aiWords)) * 100) : 0,
    avg_turn_words: user.length ? Math.round(userWords / user.length) : 0,
    distinct_words: distinct,
    wpm,
  };
}

module.exports = {
  LEVELS, MODES, CATEGORIES, SEVERITIES, SEVERITY_RANK, CORRECTION_LEVELS, LANGUAGES,
  LEVEL_GUIDE, PRACTICE_HINTS, nextLevel, computeStats,
};
