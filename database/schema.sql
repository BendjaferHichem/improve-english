-- Outloud database schema. Paste into the Supabase SQL Editor and run once.
-- Every table has Row Level Security: users can only touch their own rows.

create extension if not exists "pgcrypto";

-- ---------- profiles (one row per user; also holds preferences) ----------
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  native_language     text not null default 'ar',
  level               text not null default 'B1' check (level in ('A1','A2','B1','B2','C1','C2')),
  level_auto          boolean not null default true,
  ai_voice            text,
  speech_rate         numeric(3,2) not null default 1.00 check (speech_rate between 0.5 and 1.5),
  correction_level    text not null default 'normal' check (correction_level in ('light','normal','strict')),
  translation_enabled boolean not null default false,
  preferred_modes     text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------- sessions ----------
create table public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  mode             text not null,
  topic            text,
  level            text not null,
  context          jsonb not null default '{}',   -- snapshot used to prompt the LLM each turn
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  estimated_level  text,
  user_word_count  int not null default 0,
  report           jsonb
);
create index sessions_user_started on public.sessions (user_id, started_at desc);

-- ---------- messages (transcripts only; raw audio is never stored) ----------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity,
  session_id       uuid not null references public.sessions(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  speaker          text not null check (speaker in ('user','ai')),
  transcript       text not null,
  translation      text,
  speech_ms        int,
  correction_shown boolean not null default false,
  created_at       timestamptz not null default now()
);
create index messages_session_seq on public.messages (session_id, seq);

-- ---------- corrections (every notable mistake, including ones not said aloud) ----------
create table public.corrections (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.messages(id) on delete cascade,
  session_id     uuid not null references public.sessions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  original_text  text not null,
  corrected_text text not null,
  explanation    text,
  category       text not null,
  pattern        text not null,
  severity       text not null check (severity in ('minor','useful','important','blocking')),
  shown_to_user  boolean not null default false,
  created_at     timestamptz not null default now()
);
create index corrections_session on public.corrections (session_id);

-- ---------- mistakes (recurring patterns across sessions) ----------
create table public.mistakes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  category           text not null,
  pattern            text not null,
  frequency          int not null default 1,
  last_seen          timestamptz not null default now(),
  example_original   text,
  example_corrected  text,
  improvement_status text not null default 'active',  -- reserved; the UI currently uses last_seen
  unique (user_id, category, pattern)
);
create index mistakes_user_freq on public.mistakes (user_id, frequency desc);
create index mistakes_pattern on public.mistakes (user_id, pattern);

-- ---------- vocabulary ----------
create table public.vocabulary (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  uuid references public.sessions(id) on delete set null,
  phrase      text not null,
  meaning     text,
  example     text,
  times_seen  int not null default 1,
  first_seen  timestamptz not null default now(),
  unique (user_id, phrase)
);

-- ---------- Row Level Security ----------
alter table public.profiles    enable row level security;
alter table public.sessions    enable row level security;
alter table public.messages    enable row level security;
alter table public.corrections enable row level security;
alter table public.mistakes    enable row level security;
alter table public.vocabulary  enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "own sessions" on public.sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own messages" on public.messages
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));

create policy "own corrections" on public.corrections
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));

create policy "own mistakes" on public.mistakes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own vocabulary" on public.vocabulary
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- create a profile automatically on sign-up ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
