// lib/supabase.ts — server-side client for the agent's Supabase project.
//
// Two supported topologies, chosen by env — no code change between them:
//   (a) a SEPARATE project per customer (Acme owns + pays for it) — SUPABASE_SCHEMA=public.
//   (b) the EXISTING Nemo Supabase, isolated in a DEDICATED schema — SUPABASE_SCHEMA=nemo_support.
//       Rule #12: NEVER use the `public` schema of the shared Nemo Supabase — Prisma drops
//       non-Prisma public tables. A dedicated schema keeps the agent's KB safe alongside nemo.*.
//
// The service-role key is used server-side for ingest + retrieval; it bypasses RLS by
// design. The anon key gets NO direct table access — every read goes through /api/*.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Loose client type — the schema is dynamic (public OR a dedicated schema like nemo_amp_db),
// so we don't pin the compile-time 'public' schema parameter.
type AdminClient = SupabaseClient<any, any, any>;

const url = process.env.SUPABASE_URL;
// Prefer the service-role key (ingest/write). If absent, fall back to the ANON key:
// retrieval works read-only via the SECURITY DEFINER match_chunks() RPC, so a PUBLIC
// widget pointed at the shared Nemo Supabase can run WITHOUT a service-role key —
// a compromise of this service can't reach other data (RLS denies; the RPC only reads
// kb_chunks). Prod deploy sets ANON only.
const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const schema = process.env.SUPABASE_SCHEMA || 'public';

let cached: AdminClient | null = null;

export function supabaseAdmin(): AdminClient {
  if (!url || !apiKey) {
    throw new Error('SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY) must be set.');
  }
  // `db.schema` makes .from()/.rpc() resolve within the configured schema. The schema
  // must be in the project's PostgREST "Exposed schemas" (the `nemo` schema already is).
  if (!cached) cached = createClient(url, apiKey, { auth: { persistSession: false }, db: { schema } });
  return cached;
}
