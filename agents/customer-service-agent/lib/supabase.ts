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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const schema = process.env.SUPABASE_SCHEMA || 'public';

let cached: AdminClient | null = null;

export function supabaseAdmin(): AdminClient {
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — point this at your Supabase project.');
  }
  // `db.schema` makes .from()/.rpc() resolve within the configured schema. The schema
  // MUST be added to the project's PostgREST "Exposed schemas" (see migration.sql).
  if (!cached) cached = createClient(url, serviceKey, { auth: { persistSession: false }, db: { schema } });
  return cached;
}
