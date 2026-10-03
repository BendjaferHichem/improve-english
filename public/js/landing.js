// If a Supabase session is stored locally, point the CTAs at the dashboard (no network needed).
const signedIn = Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k));
if (signedIn) {
  document.querySelectorAll('[data-cta]').forEach((a) => { a.href = '/conversation'; });
  document.querySelectorAll('[data-signin]').forEach((a) => { a.textContent = 'Dashboard'; a.href = '/dashboard'; });
}

// Small scripted demo of the conversation screen (illustration only).
const steps = [
  { who: 'Maya', text: "Hey! How's your day been so far?", state: 'Maya is speaking', fix: '' },
  { who: 'You', text: 'Pretty good. I go to the beach with my friend yesterday.', state: 'Listening…', fix: '' },
  { who: 'Maya', text: 'Oh nice, which beach? Was it busy?', state: 'Maya is speaking', fix: 'A quick note: "I go yesterday" → "I went yesterday"' },
];
const who = document.querySelector('#demoWho');
const line = document.querySelector('#demoLine');
const state = document.querySelector('#demoState');
const fix = document.querySelector('#demoFix');
const demo = document.querySelector('#demo');
let i = 0;
function show() {
  const s = steps[i];
  who.textContent = s.who; line.textContent = s.text; state.textContent = s.state;
  fix.textContent = s.fix; fix.hidden = !s.fix;
  demo.dataset.who = s.who === 'You' ? 'user' : 'ai';
  i = (i + 1) % steps.length;
}
show();
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(show, 3800);
