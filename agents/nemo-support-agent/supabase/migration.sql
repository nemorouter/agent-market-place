-- nemo-support-agent — runs in the EXISTING Nemo Supabase, in a DEDICATED schema.
--
-- ⚠ Rule #12 (Nemo monorepo): NEVER create tables in the `public` schema of the
--   shared Nemo Supabase — Prisma drops non-Prisma public tables and has wiped data
--   before. This agent's knowledge base lives in its OWN schema: `nemo_amp_db`.
--   It sits safely alongside the existing `nemo.*` tables; same project, isolated db.
--
-- Run in: the existing Nemo Supabase project (SQL Editor or supabase db push).

create extension if not exists vector;
create schema if not exists nemo_amp_db;

-- ── Knowledge base chunks (vector(768) = text-embedding-005) ─────────────
create table if not exists nemo_amp_db.kb_chunks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  url        text,
  content    text not null,
  embedding  vector(768) not null,
  created_at timestamptz not null default now()
);
create index if not exists kb_chunks_embedding_idx
  on nemo_amp_db.kb_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ── Chat transcripts (optional analytics) ────────────────────────────────────
create table if not exists nemo_amp_db.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx
  on nemo_amp_db.chat_messages (session_id, created_at);

-- ── Cosine-similarity search RPC (resolved via SUPABASE_SCHEMA=nemo_amp_db) ──
create or replace function nemo_amp_db.match_chunks(query_embedding vector(768), match_count int)
returns table (id uuid, title text, url text, content text, similarity float)
language sql stable as $$
  select id, title, url, content, 1 - (embedding <=> query_embedding) as similarity
  from nemo_amp_db.kb_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ── RLS on (Rule #13) — service-role bypasses; anon gets no direct access ─────
alter table nemo_amp_db.kb_chunks     enable row level security;
alter table nemo_amp_db.chat_messages enable row level security;

-- ── Grants + expose the schema to PostgREST so supabase-js can reach it ──────
--   Then, in Supabase Dashboard → Settings → API → "Exposed schemas", add nemo_amp_db,
--   and run:  NOTIFY pgrst, 'reload schema';
grant usage on schema nemo_amp_db to anon, authenticated, service_role;
grant all on all tables in schema nemo_amp_db to service_role;
grant execute on all functions in schema nemo_amp_db to service_role;
