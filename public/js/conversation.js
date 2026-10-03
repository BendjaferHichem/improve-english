import { requireSession, api, guestApi } from './api.js';
import { VoiceService, splitSentences } from './voice/voiceService.js';
import { Waveform } from './voice/waveform.js';
import { renderReport } from './report.js';
import { escapeHtml, MODE_LABELS, MODE_HINTS, LEVEL_RATE, friendlyMessage, isRtl } from './ui.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  setup: $('#setup'), modes: $('#modes'), start: $('#startBtn'), setupError: $('#setupError'),
  stage: $('#stage'), topic: $('#topic'), status: $('#status'), mic: $('#micBtn'), micLabel: $('#micLabel'),
  captionWho: $('#captionWho'), caption: $('#caption'), translation: $('#translation'),
  correction: $('#correction'), notice: $('#notice'), replay: $('#replayBtn'),
  ccToggle: $('#ccToggle'), trToggle: $('#trToggle'), autoToggle: $('#autoToggle'),
  end: $('#endBtn'), dialog: $('#endDialog'), endError: $('#endError'), endErrorText: $('#endErrorText'),
    report: $('#reportView'), reportBody: $('#reportBody'), avatar: $('#avatar'),
  prev: $('#prevAi'), prevText: $('#prevText'),
};

const STATES = {
  idle: { status: 'Tap the mic and start talking', label: 'Talk', aria: 'Start talking' },
  listening: { status: "Listening… tap when you're done", label: 'Done', aria: 'Finish speaking and send' },
  processing: { status: 'Thinking…', label: 'Please wait', aria: 'Processing, please wait' },
  speaking: { status: 'Maya is speaking. Tap to interrupt', label: 'Interrupt', aria: 'Interrupt and start talking' },
  error: { status: '', label: 'Try again', aria: 'Try again' },
};

const app = {
  state: 'idle', turn: 0, sessionId: null, level: 'B1', profile: null, voice: null, wave: null,
  pending: null, lastAi: null, languages: [], mode: new URLSearchParams(location.search).get('mode') || 'surprise',
  opts: { captions: true, translate: false, autoListen: true },
};




const isGuest = new URLSearchParams(location.search).get('guest') === '1';
const GUEST_PROFILE = {
  display_name: null, native_language: 'ar', level: 'B1', speech_rate: 1, ai_voice: null,
  correction_level: 'normal', translation_enabled: false, preferred_modes: [],
};
const GUEST_ACTIONS = `
  <p class="note">Guest mode: this review is not saved and will disappear when you leave this page.</p>
  <div class="rep-actions">
    <a class="btn btn--primary" href="/login?mode=signup">Create a free account to save your progress</a>
    <a class="btn" href="/conversation?guest=1">Start another conversation</a>
    <a class="btn" href="/">Home</a>
  </div>`;




// ---------- setup ----------
async function init() {
    if (isGuest) {
    $('#guestBox').hidden = false;
    $('.setup .logo').href = '/';
    $('.setup .note').textContent = "We'll ask for your microphone. Nothing is saved. Chrome and Edge send audio to their own speech servers for recognition.";
  } else {
    await requireSession();
  }
  const profile = isGuest ? GUEST_PROFILE : (await api('/profile')).profile;
  app.profile = profile;
  app.opts.translate = profile.translation_enabled;
  syncToggles();

  app.voice = VoiceService.create({ provider: 'browser' });
  app.wave = new Waveform($('#wave'));

  if (!app.voice.capabilities.stt || !app.voice.capabilities.tts) {
    el.setupError.textContent = "Your browser doesn't support speech recognition or speech synthesis. Please open Outloud in Chrome, Edge or Safari.";
    el.setupError.hidden = false;
    el.start.disabled = true;
  }
  if (!MODE_LABELS[app.mode]) app.mode = 'surprise';
  el.modes.innerHTML = Object.keys(MODE_LABELS).map((m) => `
    <label class="mode"><input type="radio" name="mode" value="${m}" ${m === app.mode ? 'checked' : ''}>
      <span class="mode__body"><strong>${MODE_LABELS[m]}</strong><small>${MODE_HINTS[m]}</small></span></label>`).join('');
  el.modes.addEventListener('change', (e) => { app.mode = e.target.value; });
}

async function startSession() {
  el.setupError.hidden = true;
  el.start.disabled = true;
  el.start.textContent = 'Connecting…';
  try {
    await app.voice.startConversation(); // must run inside the click: unlocks speech and asks for the mic
        let res;
    if (isGuest) {
      res = await guestApi('/start', { mode: app.mode, level: $('#guestLevel').value, translate: app.opts.translate });
      app.guest = {
        context: res.context, mode: res.mode, topic: res.title, level: res.level, startedAt: new Date().toISOString(),
        history: [{ speaker: 'ai', transcript: res.opening.text, correction_shown: false }], corrections: [],
      };
    } else {
      res = await api('/conversation/start', { method: 'POST', body: { mode: app.mode, translate: app.opts.translate } });
      app.sessionId = res.sessionId;
    }
    app.level = res.level;
    el.topic.textContent = `${MODE_LABELS[res.mode]} · ${res.title}`;
    el.setup.hidden = true;
    el.stage.hidden = false;
    setState('idle');
    await sayAi(res.opening.text, res.opening.translation);
  } catch (err) {
    el.setupError.textContent = friendlyMessage(err);
    el.setupError.hidden = false;
    el.start.disabled = false;
    el.start.textContent = 'Start talking';
  }
}

// ---------- state & captions ----------
function setState(state, statusOverride) {
  app.state = state;
  const s = STATES[state];
  el.stage.dataset.state = state;
  el.status.textContent = statusOverride ?? s.status;
  el.micLabel.textContent = s.label;
  el.mic.setAttribute('aria-label', s.aria);
  el.mic.setAttribute('aria-disabled', state === 'processing');
  app.wave.setMode(state === 'error' ? 'idle' : state);
}

function showCaption(who, text, translation = null) {
  el.captionWho.textContent = who === 'ai' ? 'Maya' : 'You';
  el.caption.dataset.who = who;

  // While the learner's words are on screen, keep Maya's last line visible (smaller) above the mic.
  el.prev.hidden = !(who === 'you' && app.lastAi);
  if (!el.prev.hidden) el.prevText.textContent = app.lastAi.text;


  if (who === 'ai') {
    el.caption.innerHTML = splitSentences(text).map((s, i) => `<span class="sentence" data-i="${i}">${escapeHtml(s)} </span>`).join('');
  } else {
    el.caption.textContent = text;
  }
  showTranslation(translation);
}

function showTranslation(text) {
  const visible = app.opts.translate && text;
  el.translation.hidden = !visible;
  if (visible) {
    el.translation.textContent = text;
    el.translation.dir = isRtl(app.profile.native_language) ? 'rtl' : 'ltr';
    el.translation.lang = app.profile.native_language;
  }
}

function highlight(i) {
  el.caption.querySelectorAll('.sentence').forEach((s) => s.classList.toggle('is-active', Number(s.dataset.i) === i));
}

function showCorrection({ original, corrected, explanation }) {
  el.correction.hidden = false;
  el.correction.innerHTML = `
    <p class="correction__label">A quick note</p>
    <p><span class="correction__old">${escapeHtml(original)}</span> → <strong>${escapeHtml(corrected)}</strong></p>
    ${explanation ? `<p class="correction__why">${escapeHtml(explanation)}</p>` : ''}`;
}
const clearCorrection = () => { el.correction.hidden = true; el.correction.innerHTML = ''; };

function notify(text) { el.notice.textContent = text; el.notice.hidden = !text; }

// ---------- the conversation loop ----------
async function sayAi(text, translation) {
  const turn = ++app.turn;
  app.lastAi = { text, translation };
  notify('');
  showCaption('ai', text, translation);
  setState('speaking');
  const rate = (LEVEL_RATE[app.level] || 1) * Number(app.profile.speech_rate || 1);
  try {
    await app.voice.synthesizeSpeech(text, {
      voiceName: app.profile.ai_voice, rate, onSentence: highlight, onBoundary: () => app.wave.pulse(),
    });
  } catch (err) {
    notify(friendlyMessage(err));
  }
  if (turn !== app.turn) return; // the learner interrupted
  highlight(-1);
  if (app.opts.autoListen) listenTurn();
  else setState('idle');
}

async function listenTurn() {
  const turn = ++app.turn;
  setState('listening');
  showCaption('you', '…');
  let result;
  try {
    const listening = app.voice.transcribeAudio({ onInterim: (t) => showCaption('you', t) });
    app.voice.openLevelMeter().then((analyser) => { if (analyser && app.state === 'listening' && turn === app.turn) app.wave.attachAnalyser(analyser); });
    result = await listening;
  } catch (err) {
    app.voice.closeLevelMeter();
    if (turn !== app.turn || err.code === 'aborted') return;
    if (err.code === 'no-speech') {
      showCaption('ai', app.lastAi.text, app.lastAi.translation);
      return setState('idle', "I didn't hear anything. Tap the mic and try again.");
    }
    return fail(err);
  }
  app.voice.closeLevelMeter();
  if (turn !== app.turn) return;
  await submitTurn(result);
}

async function submitTurn(turnData) {
  app.pending = turnData;
  const turn = ++app.turn;
  setState('processing');
  showCaption('you', turnData.transcript);
  clearCorrection();
  let res;
  try {
        res = isGuest
      ? await guestTurn(turnData)
      : await api('/conversation/message', {
        method: 'POST',
        body: { sessionId: app.sessionId, transcript: turnData.transcript, speechMs: turnData.speechMs, translate: app.opts.translate },
      });
  } catch (err) {
    if (turn === app.turn) fail(err);
    return;
  }
  if (turn !== app.turn) return;
  app.pending = null;
  if (res.correction) showCorrection(res.correction);
  await sayAi(res.reply, res.translation);
}




// Guest mode keeps the whole conversation in the browser; nothing is saved anywhere.
async function guestTurn(turnData) {
  const g = app.guest;
  const res = await guestApi('/message', {
    context: g.context, history: g.history.slice(-12), transcript: turnData.transcript, translate: app.opts.translate,
  });
  g.history.push(
    { speaker: 'user', transcript: turnData.transcript, speech_ms: turnData.speechMs },
    { speaker: 'ai', transcript: res.reply, correction_shown: Boolean(res.correction) },
  );
  g.corrections.push(...res.corrections);
  return res;
}





function fail(err) {
  setState('error', friendlyMessage(err));
}

// ---------- controls ----------
el.start.addEventListener('click', startSession);

el.mic.addEventListener('click', () => {
  switch (app.state) {
    case 'idle': return listenTurn();
    case 'listening': return app.voice.finishListening();
    case 'speaking': app.turn++; app.voice.interrupt(); return listenTurn();
    case 'error': return app.pending ? submitTurn(app.pending) : setState('idle');
    default: return undefined;
  }
});

el.replay.addEventListener('click', () => {
  if (!app.lastAi || app.state === 'processing') return;
  app.voice.interrupt();
  sayAi(app.lastAi.text, app.lastAi.translation);
});

function syncToggles() {
  for (const [btn, key] of [[el.ccToggle, 'captions'], [el.trToggle, 'translate'], [el.autoToggle, 'autoListen']]) {
    btn.setAttribute('aria-pressed', app.opts[key]);
  }
  el.caption.parentElement.hidden = !app.opts.captions;
}

el.ccToggle.addEventListener('click', () => { app.opts.captions = !app.opts.captions; syncToggles(); });
el.autoToggle.addEventListener('click', () => { app.opts.autoListen = !app.opts.autoListen; syncToggles(); });
el.trToggle.addEventListener('click', async () => {
  app.opts.translate = !app.opts.translate;
  syncToggles();
  if (!app.lastAi) return;
  if (!app.opts.translate) return showTranslation(null);
  if (!app.lastAi.translation) {
    
    try {
      const request = isGuest
        ? guestApi('/translate', { text: app.lastAi.text, language: app.profile.native_language })
        : api('/conversation/translate', { method: 'POST', body: { text: app.lastAi.text } });
      app.lastAi.translation = (await request).translation;
    }


    catch (err) { notify(friendlyMessage(err)); }
  }
  if (el.caption.dataset.who === 'ai') showTranslation(app.lastAi.translation);
});

// ---------- ending ----------
el.end.addEventListener('click', () => { app.voice.interrupt(); if (app.state !== 'processing') setState('idle'); el.dialog.showModal(); });
el.dialog.addEventListener('close', () => { if (el.dialog.returnValue === 'end') finishSession(); });

async function finishSession(skipAi = false) {
  app.turn++;
  app.voice.endConversation();
  el.endError.hidden = true;
  setState('processing', 'Writing your report…');
  try {
        const data = isGuest
      ? await guestApi('/end', {
        mode: app.guest.mode, topic: app.guest.topic, level: app.guest.level, startedAt: app.guest.startedAt,
        history: app.guest.history, corrections: app.guest.corrections, skipAi,
      })
      : await api('/conversation/end', { method: 'POST', body: { sessionId: app.sessionId, skipAi } });
    el.stage.hidden = true;
    el.report.hidden = false;
    renderReport(el.reportBody, data, { actions: !isGuest });
    if (isGuest) el.reportBody.insertAdjacentHTML('beforeend', GUEST_ACTIONS);
    scrollTo(0, 0);
    el.reportBody.querySelector('h1')?.setAttribute('tabindex', '-1');
    el.reportBody.querySelector('h1')?.focus();
  } catch (err) {
    el.endErrorText.textContent = friendlyMessage(err);
    el.endError.hidden = false;
    setState('idle', '');
  }
}
$('#retryEnd').addEventListener('click', () => finishSession(false));
$('#skipEnd').addEventListener('click', () => finishSession(true));

addEventListener('pagehide', () => app.voice?.endConversation());

init().catch((err) => {
  el.setupError.textContent = friendlyMessage(err);
  el.setupError.hidden = false;
  el.start.disabled = true;
});
