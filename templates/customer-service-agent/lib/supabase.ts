// lib/supabase.ts — server-side client for the CUSTOMER's OWN Supabase project.
//
// This project is SEPARATE per customer (Acme's data lives in Acme's project, which
// Acme creates + pays for). The service-role key is used server-side for ingest +
// retrieval; it bypasses RLS by design. The public anon key gets NO direct table
// access (see supabase/migration.sql) — every read goes through this app's /api/*.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — point this at YOUR Supabase project.');
  }
  if (!cached) cached = createClient(url, serviceKey, { auth: { persistSession: false } });
  return cached;
}
