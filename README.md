# Outloud

Voice-first English practice. You talk, an AI called Maya talks back, and useful corrections arrive inside the conversation instead of in a grammar exercise. There is no text chat box by design.

## Features

- Voice loop: speak → speech recognition → AI reply → spoken reply, with live captions and optional translation (Arabic by default; more languages are one line in `services/learning.js`)
- Seven conversation types (casual, random topic, story, travel, roleplay, debate, scenario) plus "Surprise me"
- Correction engine: every turn is analysed into a structured result (never shown raw). Minor slips are ignored, useful ones corrected in one friendly sentence, repeated ones explained. Correction intensity: light / normal / strict
- Learner profile: recurring mistake patterns are stored and steer future conversations (for example, past-tense problems make the AI ask "what did you do yesterday?"), without announcing a lesson
- Level adaptation: A1–C2 prompts and speaking speed; your stored level moves at most one step, and only when two consecutive sessions agree
- End-of-session review: summary, AI-estimated scores (clearly labelled as estimates), real measured stats, top mistakes, recurring patterns, new expressions, suggestions
- Dashboard, history, settings, delete-my-history
- Supabase Auth (email/password) with Row Level Security

## Stack

| Part | Choice |
|---|---|
| Frontend | Plain HTML, CSS, ES modules. No build step |
| Backend | Node.js + Express (local server; one Vercel function in production) |
| Database and auth | Supabase (Postgres + Auth) |
| LLM | Google Gemini via AI Studio free key by default; any OpenAI-compatible API (Groq, OpenRouter) via env vars |
| Speech-to-text, text-to-speech | Browser Web Speech API (free) |
| Hosting | Vercel |

## Structure

```
api/index.js            Vercel entry (re-exports app.js)
app.js                  Express app
server.js               Local dev server (API + static files)
routes/                 conversation, sessions, profile, progress, speech
middleware/             auth (verifies Supabase JWT), errors
services/
  aiService.js          LLM providers + parsing/validation of model output
  prompts.js            All prompts (persona, correction rules, report)
  scenarios.js          Random conversation engine
  learning.js           Levels, categories, stats, level movement
  databaseService.js    All Supabase queries
  speechService.js      Server-side speech seam (currently browser-only)
database/schema.sql     Tables, RLS policies, sign-up trigger
public/                 Pages, CSS, and js/ (voice/ holds VoiceService, provider, waveform)
```

## Run locally

1. Node 18+.
2. `npm install`
3. `cp .env.example .env` and fill it in (see below).
4. Create the database (next section).
5. `npm run dev`, then open http://localhost:3000 in **Chrome or Edge** (best speech support). `localhost` counts as a secure context, so the microphone works.

## Supabase setup

1. Create a project at supabase.com (free plan).
2. SQL Editor → paste all of `database/schema.sql` → Run.
3. Project Settings → API: copy the Project URL and the **anon** key into `.env`. Never use the `service_role` key.
4. Authentication → Providers → Email is on by default. For quick local testing you can turn off "Confirm email"; otherwise sign-up sends a confirmation link.
5. Before deploying, add your Vercel URL under Authentication → URL Configuration (Site URL and redirect URLs) so confirmation and reset emails link correctly.

## Environment variables

| Variable | Needed | Meaning |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_ANON_KEY` | yes | Public anon key (safe in the browser; RLS protects data) |
| `AI_API_KEY` | yes | Key for the LLM provider. Stays on the server |
| `AI_PROVIDER` | no | `gemini` (default), `groq`, `openrouter`, or `openai-compatible` |
| `AI_MODEL` | no | Model id. Default `gemini-2.5-flash`; see note below |
| `AI_BASE_URL` | only for `openai-compatible` | e.g. `https://api.groq.com/openai/v1` |
| `AI_GEMINI_THINKING_BUDGET` | no | `0` lowers latency on Gemini 2.5 Flash. Unset if your model rejects it |
| `PORT` | no | Local port |

**Get a free LLM key:** https://aistudio.google.com → Get API key (no card). Free-tier model lineups and limits change often. When this was written, the free tier covered Flash and Flash-Lite models only, at roughly 10–15 requests per minute and a few hundred to ~1,500 per day, and Google may use free-tier prompts to improve its products. Check the current limits and model names in AI Studio; if you see "the configured AI model isn't available", update `AI_MODEL`. To use Groq instead: `AI_PROVIDER=groq`, a Groq key from console.groq.com, and a current model id from their console.

## Deploy (GitHub → Vercel → Supabase)

1. `git init && git add . && git commit -m "Outloud"` and push to a new GitHub repo. `.env` is git-ignored.
2. vercel.com → Add New Project → import the repo. Leave framework as "Other"; `vercel.json` sets the output folder, rewrites and function timeout.
3. Add the environment variables above in Project Settings → Environment Variables.
4. Deploy, then add the deployed URL in Supabase (step 5 above).

Vercel's free Hobby plan is for personal, non-commercial use. Supabase free projects **pause after 7 days of inactivity** (restore them from the dashboard). The free LLM key's rate limit is shared by all your users, so this setup suits personal use and small demos.

## Privacy: what is stored

Transcripts, corrections, recurring-mistake counts, vocabulary, and reports. Raw audio is never stored by this app. Speech recognition runs through your browser: Chrome and Edge send audio to their vendors' speech servers to do it. Settings → "Delete all my conversation history" removes sessions, messages, corrections, mistakes and vocabulary.

## Swapping providers

- **LLM:** add a function to `providers` in `services/aiService.js` (it receives system prompt + messages and returns JSON text).
- **Voice:** `public/js/voice/voiceService.js` is the only voice API the UI uses (`startConversation`, `transcribeAudio`, `synthesizeSpeech`, `stopSpeaking`, `interrupt`, `endConversation`). Write a provider with the same methods as `browserProvider.js`, register it in `PROVIDERS`, and return its name from `services/speechService.js`. Keep paid keys server-side and call them through `/api/speech/*` (currently answering 501 on purpose).

## Known limitations (honest list)

- **No true barge-in.** You can tap the mic to interrupt Maya, but the app does not listen while she speaks: browser recognition would hear her own voice. Real interruption needs streaming STT with echo cancellation (Phase 4).
- **No pronunciation feedback.** Browser recognition returns text only, so pronunciation and accent cannot be judged, and the app does not pretend to. Spelling is ignored for the same reason.
- **Recognition may "fix" your grammar.** Speech engines use language models and sometimes normalise mistakes, so a few errors never reach the tutor.
- **Voice quality depends on the device.** Chrome/Edge/Safari often ship natural-sounding voices; pick one in Settings. Firefox has no speech recognition.
- Waveform: while you talk it shows your real microphone level. While Maya talks, the browser gives no audio data, so it is driven by word-boundary events (a steady wave on voices that send none).
- Scores are AI estimates from one conversation. Words-per-minute includes pauses.
- Conversations closed mid-way stay unfinished; open them from the report page link to generate a review.
- Not tested against a live Supabase project or real microphone in this build environment: run the full flow once yourself (sign up → conversation → end).

## Roadmap

Streaming STT and neural TTS providers, real voice interruption, pronunciation scoring from a provider that supports it, OAuth sign-in (see comment in `public/js/auth.js`), spaced review of saved expressions.
