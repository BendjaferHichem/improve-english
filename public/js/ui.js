export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export const MODE_LABELS = {
  surprise: 'Surprise me', casual: 'Casual chat', random: 'Random topic', story: 'Story',
  travel: 'Travel', roleplay: 'Roleplay', debate: 'Debate', scenario: 'Scenario',
};

export const MODE_HINTS = {
  surprise: 'We pick something for you',
  casual: 'Everyday conversation',
  random: 'An unexpected topic',
  story: 'Tell and build a story',
  travel: 'Airports, hotels, directions',
  roleplay: 'Interviews, appointments, calls',
  debate: 'Defend your opinion',
  scenario: 'A realistic situation',
};

// Slower AI speech for lower levels; multiplied by the user's own speed setting.
export const LEVEL_RATE = { A1: 0.85, A2: 0.9, B1: 0.97, B2: 1, C1: 1.03, C2: 1.05 };

export const VOICE_MESSAGES = {
  'mic-denied': 'Microphone access was blocked. Please allow microphone access in your browser settings and try again.',
  'mic-unavailable': "We couldn't find a working microphone. Check that one is connected and not in use by another app.",
  'stt-unsupported': "Your browser doesn't support speech recognition. Please use Chrome, Edge or Safari.",
  'tts-unsupported': "Your browser can't speak out loud. Please use Chrome, Edge or Safari.",
  'stt-network': 'Speech recognition lost its connection. Check your internet and try again.',
  'stt-failed': "Speech recognition didn't work that time. Please try again.",
  'stt-start-failed': "We couldn't start listening. Please tap the microphone again.",
  'tts-failed': "The voice couldn't play. You can still read the captions.",
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(iso).toLocaleDateString(undefined, opts);
}

export const RTL_LANGUAGES = new Set(['ar', 'fa', 'ur', 'he']);
export const isRtl = (code) => RTL_LANGUAGES.has(code);

export function friendlyMessage(err) {
  if (err?.code && VOICE_MESSAGES[err.code]) return VOICE_MESSAGES[err.code];
  return err?.message || 'Something went wrong. Please try again.';
}
