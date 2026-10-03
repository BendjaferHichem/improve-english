import { requireSession, api } from './api.js';
import { escapeHtml, formatDate, MODE_LABELS, friendlyMessage } from './ui.js';

const DAYS = 14;

function activityStrip(activity) {
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    days.push({ date: d, words: 0 });
  }
  for (const s of activity) {
    const d = new Date(s.started_at); d.setHours(0, 0, 0, 0);
    const slot = days.find((x) => x.date.getTime() === d.getTime());
    if (slot) slot.words += s.user_word_count || 0;
  }
  const max = Math.max(...days.map((d) => d.words), 1);
  return `<div class="strip" role="img" aria-label="Words you spoke per day over the last ${DAYS} days">
    ${days.map((d) => `<span class="strip__day" title="${formatDate(d.date, { day: 'numeric', month: 'short' })}: ${d.words} words">
      <span class="strip__bar" style="height:${Math.max(4, (d.words / max) * 100)}%"></span></span>`).join('')}</div>`;
}

function render(p) {
  const name = p.profile.display_name;
  document.querySelector('#greeting').textContent = name ? `Hi, ${name}` : 'Welcome';
  document.querySelector('#headline').textContent = p.totals.sessions
    ? `${p.week.sessions} conversation${p.week.sessions === 1 ? '' : 's'} this week.` : 'Ready for your first conversation?';

  const focus = p.focus.length ? `<ul class="focus">${p.focus.map((f) => `
    <li><strong>${escapeHtml(f.pattern)}</strong> <span class="muted">· seen ${f.frequency}×</span>
      ${f.example_original ? `<br>"${escapeHtml(f.example_original)}" → <strong>"${escapeHtml(f.example_corrected)}"</strong>` : ''}
      <br><span class="muted">Next chats will lean towards: ${escapeHtml(f.hint)}.</span></li>`).join('')}</ul>`
    : '<p class="muted">Nothing yet. Have a conversation and your recurring patterns will show up here.</p>';

  const recent = p.recent.length ? `<ul class="list">${p.recent.map((s) => `
    <li><a href="/report?id=${s.id}"><strong>${escapeHtml(s.topic || MODE_LABELS[s.mode])}</strong>
    <span class="muted">${MODE_LABELS[s.mode] || ''} · ${formatDate(s.started_at, { day: 'numeric', month: 'short' })}${s.user_word_count ? ` · ${s.user_word_count} words` : ''}</span></a></li>`).join('')}</ul>`
    : '<p class="muted">No finished conversations yet.</p>';

  const vocab = p.vocabulary.length ? `<ul class="chips">${p.vocabulary.map((v) => `<li title="${escapeHtml(v.meaning || '')}">${escapeHtml(v.phrase)}</li>`).join('')}</ul>` : '<p class="muted">New expressions from your conversations will collect here.</p>';

  document.querySelector('#content').innerHTML = `
        <section class="panel panel--level">
      <h2>Where you are</h2>
      <p class="level">${p.latest_estimate || p.profile.level}</p>
      <p class="muted">${p.latest_estimate ? 'AI estimate from your last conversation.' : 'Your set level. Finish a conversation to get an estimate.'}
        Your practice level is ${p.profile.level}${p.profile.level_auto ? ', adjusted gradually' : ', set by you'}.
        ${p.totals.sessions} conversation${p.totals.sessions === 1 ? '' : 's'} so far.</p>
    </section>
    <section class="panel"><h2>What to improve</h2>${focus}</section>
    <section class="panel"><h2>Speaking activity</h2>${activityStrip(p.activity)}<p class="muted">${p.week.words} words spoken in the last 7 days.</p></section>
    <section class="panel"><h2>Recent conversations</h2>${recent}</section>
    <section class="panel"><h2>Expressions collected <span class="muted">(${p.totals.vocabulary})</span></h2>${vocab}</section>`;
}

requireSession()
  .then(() => api('/progress'))
  .then(render)
  .catch((err) => {
    document.querySelector('#content').innerHTML = '';
    const box = document.querySelector('#error');
    box.textContent = friendlyMessage(err);
    box.hidden = false;
  });
