import { requireSession, api } from './api.js';
import { renderReport } from './report.js';
import { escapeHtml, friendlyMessage } from './ui.js';

const body = document.querySelector('#body');
const errorBox = document.querySelector('#error');
const id = new URLSearchParams(location.search).get('id');

async function load() {
  await requireSession();
  if (!id) throw new Error('No conversation selected.');
  const data = await api(`/sessions/${encodeURIComponent(id)}`);

  if (!data.session.ended_at) {
    body.innerHTML = '<h1>This conversation was never finished.</h1><p><button class="btn btn--primary" id="finish">Create its review now</button></p>';
    document.querySelector('#finish').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { renderReport(body, await api('/conversation/end', { method: 'POST', body: { sessionId: id } }), { heading: 'Conversation review' }); }
      catch (err) { errorBox.textContent = friendlyMessage(err); errorBox.hidden = false; e.target.disabled = false; }
    });
  } else {
    renderReport(body, data, { heading: 'Conversation review' });
  }

  const box = document.querySelector('#transcript');
  document.querySelector('#transcriptBody').innerHTML = data.messages.map((m) => `
    <p class="turn turn--${m.speaker}"><strong>${m.speaker === 'ai' ? 'Maya' : 'You'}</strong> ${escapeHtml(m.transcript)}
    ${m.corrections.map((c) => `<br><small class="muted">${escapeHtml(c.original)} → ${escapeHtml(c.corrected)}</small>`).join('')}</p>`).join('');
  box.hidden = false;
}

load().catch((err) => { body.innerHTML = ''; errorBox.textContent = friendlyMessage(err); errorBox.hidden = false; });
