-- migration.sql — run this once in the CUSTOMER's OWN Supabase project.
-- (Supabase dashboard → SQL Editor → paste → Run.  Or: supabase db push.)
--
-- Creates the pgvector knowledge base + optional chat history, with RLS ON by default.
--
-- IMPORTANT: vector(768) must match your EMBEDDING_MODEL's output dimension.
--   text-embedding-005 = 768 (Vertex default). Match your model's output dimension.
-- If you change the model, change the number in BOTH places below.

create extension if not exists vector;

-- ── Knowledge base chunks ────────────────────────────────────────────────────
create table if not exists public.kb_chunks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  url        text,
  content    text not null,
  embedding  vector(768) not null,
  created_at timestamptz not null default now()
);

create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ── Chat transcripts (optional analytics) ────────────────────────────────────
create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx on public.chat_messages (session_id, created_at);

-- ── Optional: per-audience doc scoping (signed-in personalization) ───────────
-- Tag chunks with the audiences allowed to see them, e.g. {public} or {public,pro}.
-- Anonymous visitors get the {public} default; signed-in users get docs whose
-- audiences overlap their entitlements (resolved in lib/identity.ts). Additive +
-- idempotent — existing rows default to {public} so prior behavior is unchanged.
alter table public.kb_chunks
  add column if not exists audiences text[] not null default '{public}';

-- ── Cosine-similarity search RPC used by lib/retrieval.ts ────────────────────
-- match_audiences IS NULL → unscoped (anonymous). Non-null → require overlap.
-- Drop the legacy 2-arg signature first: the new arg has a DEFAULT, so keeping
-- both would make a 2-arg call ambiguous. Safe + idempotent.
drop function if exists public.match_chunks(vector, int);
create or replace function public.match_chunks(
  query_embedding vector(768),
  match_count int,
  match_audiences text[] default null
)
returns table (id uuid, title text, url text, content text, similarity float)
language sql stable as $$
  select id, title, url, content, 1 - (embedding <=> query_embedding) as similarity
  from public.kb_chunks
  where match_audiences is null or audiences && match_audiences
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ── Operator-editable agent settings (the /admin dashboard writes here) ──────
-- One row per agent (keyed by AGENT_ID). `settings` is the editable projection:
-- agentName, systemPrompt, model, greet, suggestions[], quickLinks[], contactMethods[].
-- lib/settings.ts overlays this row on top of the env/built-in defaults; a missing
-- row (or missing table) just means "use the defaults". Additive + idempotent.
create table if not exists public.agent_config (
  agent_id   text primary key,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── RLS: lock everything down ────────────────────────────────────────────────
-- The app uses the service-role key server-side (bypasses RLS); the public anon
-- key gets NO direct table access. All reads/writes go through this app's /api/*.
alter table public.kb_chunks     enable row level security;
alter table public.chat_messages enable row level security;
alter table public.agent_config  enable row level security;
-- (Intentionally no permissive policies — anon cannot select/insert directly.)
