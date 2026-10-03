import { requireSession, api, getSupabase, signOut } from './api.js';
import { LEVELS, MODE_LABELS, friendlyMessage } from './ui.js';
import { loadVoices, BrowserVoiceProvider } from './voice/browserProvider.js';

const $ = (s) => document.querySelector(s);
const form = $('#form');
const showError = (err) => { $('#error').textContent = friendlyMessage(err); $('#error').hidden = false; };

async function init() {
  await requireSession();
  const [{ profile }, { config }, voices] = await Promise.all([api('/profile'), getSupabase(), loadVoices()]);

  $('#level').innerHTML = LEVELS.map((l) => `<option>${l}</option>`).join('');
  $('#native_language').innerHTML = config.languages.map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
  $('#ai_voice').innerHTML = '<option value="">Best available</option>' + voices.map((v) => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name} (${v.lang})</option>`).join('');
  $('#modes').innerHTML = Object.entries(MODE_LABELS).filter(([k]) => k !== 'surprise')
    .map(([k, v]) => `<label class="check"><input type="checkbox" name="mode" value="${k}"> ${v}</label>`).join('');

  $('#display_name').value = profile.display_name || '';
  $('#level').value = profile.level;
  $('#level_auto').checked = profile.level_auto;
  $('#native_language').value = profile.native_language;
  $('#translation_enabled').checked = profile.translation_enabled;
  $('#ai_voice').value = profile.ai_voice || '';
  $('#speech_rate').value = profile.speech_rate;
  $('#rateOut').textContent = Number(profile.speech_rate).toFixed(2);
  form.querySelector(`[name=correction_level][value=${profile.correction_level}]`).checked = true;
  form.querySelectorAll('[name=mode]').forEach((c) => { c.checked = profile.preferred_modes.includes(c.value); });
  form.hidden = false;
}

$('#speech_rate').addEventListener('input', (e) => { $('#rateOut').textContent = Number(e.target.value).toFixed(2); });

$('#testVoice').addEventListener('click', () => {
  const provider = new BrowserVoiceProvider();
  provider.speak("Hey! It's nice to meet you. How's your day going?", {
    voiceName: $('#ai_voice').value || undefined, rate: Number($('#speech_rate').value),
  }).catch(showError);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#error').hidden = $('#saved').hidden = true;
  try {
    await api('/profile', { method: 'PATCH', body: {
      display_name: $('#display_name').value, level: $('#level').value, level_auto: $('#level_auto').checked,
      native_language: $('#native_language').value, translation_enabled: $('#translation_enabled').checked,
      ai_voice: $('#ai_voice').value || null, speech_rate: Number($('#speech_rate').value),
      correction_level: form.querySelector('[name=correction_level]:checked').value,
      preferred_modes: [...form.querySelectorAll('[name=mode]:checked')].map((c) => c.value),
    } });
    $('#saved').hidden = false;
    scrollTo(0, 0);
  } catch (err) { showError(err); }
});

$('#deleteBtn').addEventListener('click', async () => {
  if (!confirm('Delete all your conversations, corrections, vocabulary and progress? This cannot be undone.')) return;
  try { await api('/history', { method: 'DELETE' }); alert('Your conversation history was deleted.'); }
  catch (err) { showError(err); }
});
$('#signOut').addEventListener('click', signOut);

init().catch(showError);
