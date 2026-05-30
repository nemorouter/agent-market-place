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

-- ── Cosine-similarity search RPC used by lib/retrieval.ts ────────────────────
create or replace function public.match_chunks(query_embedding vector(768), match_count int)
returns table (id uuid, title text, url text, content text, similarity float)
language sql stable as $$
  select id, title, url, content, 1 - (embedding <=> query_embedding) as similarity
  from public.kb_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ── RLS: lock everything down ────────────────────────────────────────────────
-- The app uses the service-role key server-side (bypasses RLS); the public anon
-- key gets NO direct table access. All reads/writes go through this app's /api/*.
alter table public.kb_chunks     enable row level security;
alter table public.chat_messages enable row level security;
-- (Intentionally no permissive policies — anon cannot select/insert directly.)
