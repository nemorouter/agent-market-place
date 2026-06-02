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
const anonKey = process.env.SUPABASE_ANON_KEY;
const schema = process.env.SUPABASE_SCHEMA || 'public';

// Two clients, two trust levels:
//   • supabaseAdmin()   — prefers the service-role key, falls back to ANON. Used for
//     RETRIEVAL, which works read-only via the SECURITY DEFINER match_chunks() RPC even
//     on an anon key, so a public widget can run without a service-role key (a compromise
//     can't reach other data; RLS denies; the RPC only reads kb_chunks).
//   • supabaseService() — REQUIRES the service-role key. Used for every WRITE/direct-table
//     path (settings upsert, ingest). These genuinely bypass RLS, so an ANON-only deploy
//     must fail LOUDLY here rather than emit confusing per-row RLS errors at runtime.
const readKey = serviceKey || anonKey;

let cachedRead: AdminClient | null = null;
let cachedService: AdminClient | null = null;

function make(key: string): AdminClient {
  // `db.schema` makes .from()/.rpc() resolve within the configured schema. The schema
  // must be in the project's PostgREST "Exposed schemas" (the `nemo` schema already is).
  return createClient(url as string, key, { auth: { persistSession: false }, db: { schema } });
}

/** Read/RPC client — service-role if present, else anon (retrieval-only path). */
export function supabaseAdmin(): AdminClient {
  if (!url || !readKey) {
    throw new Error('SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY) must be set.');
  }
  if (!cachedRead) cachedRead = make(readKey);
  return cachedRead;
}

/** Write client — requires the RLS-bypassing service-role key. Throws a clear error
 *  on an anon-only deploy instead of failing silently on the first write. */
export function supabaseService(): AdminClient {
  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for this operation (settings save / ingest). ' +
        'An anon-only deploy can serve chat but cannot write — set the service-role key.',
    );
  }
  if (!cachedService) cachedService = make(serviceKey);
  return cachedService;
}
