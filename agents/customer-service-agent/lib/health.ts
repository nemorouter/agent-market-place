// lib/health.ts — readiness probe logic, kept pure-ish so it's unit-testable.
//
// A "ready" agent is one that can serve chat: it must reach its own Supabase (KB +
// settings live there) and have a Nemo virtual key configured. The Supabase check
// is a bounded metadata count against the config table (no row data, no LLM spend).
// Every check is wrapped — a probe must never throw; it degrades to `false`.
import { supabaseAdmin } from './supabase';
import { rateLimitBackend } from './security';
import { vaultConfigured } from './vault';

export interface ReadinessReport {
  ready: boolean;
  checks: {
    supabase: boolean;
    nemoKey: boolean;
    vault: boolean;
  };
  rateLimiter: 'redis' | 'memory';
}

/** Probe Supabase with a cheap, bounded count. Never throws → false on any error. */
export async function probeSupabase(): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin()
      .from('agent_config')
      .select('agent_id', { count: 'exact', head: true })
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Assemble the readiness report. Supabase is the only HARD dependency for `ready`. */
export async function checkReadiness(): Promise<ReadinessReport> {
  const supabase = await probeSupabase();
  const nemoKey = Boolean(process.env.NEMOROUTER_API_KEY);
  const vault = vaultConfigured();
  return {
    ready: supabase && nemoKey,
    checks: { supabase, nemoKey, vault },
    rateLimiter: rateLimitBackend(),
  };
}
