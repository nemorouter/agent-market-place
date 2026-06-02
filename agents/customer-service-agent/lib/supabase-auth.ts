// lib/supabase-auth.ts — anon-key Supabase client for Admin OTP login.
//
// Separate from lib/supabase.ts (which uses the service-role key + a DB schema for
// the data plane). This one only touches Supabase Auth (signInWithOtp / verifyOtp)
// with the ANON key — no table access, no schema scoping. Used solely by the
// /api/admin/* OTP routes.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

export function supabaseAuth(): SupabaseClient {
  if (!url || !anon) {
    throw new Error('SUPABASE_URL + SUPABASE_ANON_KEY are required for admin OTP login.');
  }
  if (!cached) {
    cached = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cached;
}
