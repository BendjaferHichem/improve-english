import { escapeHtml, MODE_LABELS, formatDate } from './ui.js';

const CATEGORY_LABELS = {
  grammar: 'Grammar', verb_tense: 'Verb tense', articles: 'Articles', prepositions: 'Prepositions',
  word_order: 'Word order', vocabulary: 'Vocabulary', sentence_structure: 'Sentence structure',
  unnatural_phrasing: 'Natural phrasing', word_choice: 'Word choice', agreement: 'Agreement',
  pluralization: 'Plurals', contractions: 'Contractions', fluency: 'Fluency',
};
const label = (c) => CATEGORY_LABELS[c] || 'Grammar';

function meter(score) {
  const filled = '●'.repeat(score) + '○'.repeat(5 - score);
  return `<span class="meter" role="img" aria-label="${score} out of 5"><span aria-hidden="true">${filled}</span> <span class="meter__num">${score}/5</span></span>`;
}

function section(title, body) {
  return body ? `<section class="rep-section"><h2>${title}</h2>${body}</section>` : '';
}

// `data` is the payload of POST /conversation/end or the `report` + `session` from GET /sessions/:id.
export function renderReport(container, { session, report }, { heading = 'Session complete.', actions = true } = {}) {
  const r = report || {};
  const s = r.stats || {};
  const perf = r.performance;

  const performance = perf ? `
    <p class="note">These scores are AI estimates from a single conversation, not an official test result.</p>
    <dl class="perf">
      ${['fluency', 'vocabulary', 'grammar', 'naturalness'].map((k) => `
        <div class="perf__row"><dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${meter(perf[k].score)}<span class="perf__note">${escapeHtml(perf[k].note)}</span></dd></div>`).join('')}
    </dl>
    ${r.participation_note ? `<p>${escapeHtml(r.participation_note)}</p>` : ''}` : (r.ai_available === false && s.user_turns
      ? '<p class="note">The AI summary and scores weren\'t available for this session, but your measured stats and corrections are below.</p>' : '');

  const stats = s.user_turns ? `
    <ul class="stats" aria-label="Measured speaking stats">
      <li><strong>${s.talk_share}%</strong><span>of the words were yours</span></li>
      <li><strong>${s.avg_turn_words}</strong><span>words per turn</span></li>
      <li><strong>${s.distinct_words}</strong><span>different words you used</span></li>
      ${s.wpm ? `<li><strong>~${s.wpm}</strong><span>words per minute*</span></li>` : ''}
    </ul>
    ${s.wpm ? '<p class="note">*Approximate: measured from when you started to when you finished each answer, pauses included.</p>' : ''}` : '';

  const mistakes = (r.mistakes || []).map((m) => `
    <article class="fix">
      <p class="fix__said"><span>You said</span> ${escapeHtml(m.original)}</p>
      <p class="fix__better"><span>Better</span> ${escapeHtml(m.corrected)}</p>
      ${m.explanation ? `<p class="fix__why"><span>Why</span> ${escapeHtml(m.explanation)}</p>` : ''}
      <p class="fix__tag">${label(m.category)}</p>
    </article>`).join('');

  const patterns = (r.recurring_patterns || []).length ? `<ul class="plain">${r.recurring_patterns.map((p) => `
    <li><strong>${label(p.category)}: ${escapeHtml(p.pattern)}</strong>, seen ${p.frequency} times.
    ${p.example_original ? `<br><span class="muted">"${escapeHtml(p.example_original)}" → "${escapeHtml(p.example_corrected)}"</span>` : ''}</li>`).join('')}</ul>` : '';

  const expressions = (r.new_expressions || []).length ? `<ul class="plain">${r.new_expressions.map((e) => `
    <li><strong>${escapeHtml(e.phrase)}</strong>${e.meaning ? `: ${escapeHtml(e.meaning)}` : ''}${e.example ? `<br><span class="muted">${escapeHtml(e.example)}</span>` : ''}</li>`).join('')}</ul>` : '';

  const suggestions = (r.suggestions || []).length ? `<ol class="plain">${r.suggestions.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>` : '';

  container.innerHTML = `
    <header class="rep-head">
      <p class="eyebrow">${escapeHtml(MODE_LABELS[session.mode] || 'Conversation')} · ${escapeHtml(session.topic || '')} · ${formatDate(session.started_at)}</p>
      <h1>${escapeHtml(heading)}</h1>
      ${r.summary ? `<p class="lede">${escapeHtml(r.summary)}</p>` : ''}
            ${r.estimated_level ? `<p class="note">AI estimate of your level in this conversation: <strong>${escapeHtml(r.estimated_level)}</strong>. It's based on one short chat, so treat it as a rough guide.</p>` : ''}
    </header>
    ${section('Speaking performance', performance + stats)}
    ${section('Worth fixing', mistakes)}
    ${section('Patterns that keep coming back', patterns)}
    ${section('New expressions', expressions)}
    ${section('Try this next time', suggestions)}
    ${!mistakes && s.user_turns ? '<p class="note">No notable mistakes were recorded in this conversation.</p>' : ''}
    ${actions ? `<div class="rep-actions"><a class="btn btn--primary" href="/conversation">Start another conversation</a><a class="btn" href="/dashboard">Back to dashboard</a></div>` : ''}`;
}
