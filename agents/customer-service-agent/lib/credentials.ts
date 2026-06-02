// lib/credentials.ts — store/fetch tool credentials, sealed by the agent-infra vault.
//
// Write path: plaintext → vault.seal() → store ONLY the ciphertext blob in the
// agent's own Supabase. Read path (tool execution): load blob → vault.open() →
// plaintext, used for ONE transient gateway call. The plaintext is never persisted,
// never logged, and never leaves this server process except as the per-call
// credential handed to the gateway. nemo-backend never sees the vault key.

import { supabaseAdmin } from './supabase';
import { seal, open, type Sealed } from './vault';

const TABLE = 'tool_credentials';

/** Seal + upsert a tool credential. Throws if TOOL_VAULT_KEY is unset (vault off). */
export async function setCredential(agentId: string, toolId: string, secret: string): Promise<void> {
  const sealed = seal(secret); // throws on missing/invalid key — fail loud on write
  const { error } = await supabaseAdmin()
    .from(TABLE)
    .upsert(
      { agent_id: agentId, tool_id: toolId, ...sealed, updated_at: new Date().toISOString() },
      { onConflict: 'agent_id,tool_id' },
    );
  if (error) throw new Error(error.message);
}

/** Remove a stored credential (idempotent). */
export async function clearCredential(agentId: string, toolId: string): Promise<void> {
  const { error } = await supabaseAdmin().from(TABLE).delete().eq('agent_id', agentId).eq('tool_id', toolId);
  if (error) throw new Error(error.message);
}

/** Open the stored credential for a tool, or null if none / unreadable. Never throws. */
export async function getCredential(agentId: string, toolId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from(TABLE)
      .select('ciphertext, iv, tag')
      .eq('agent_id', agentId)
      .eq('tool_id', toolId)
      .maybeSingle();
    if (error || !data) return null;
    return open(data as Sealed);
  } catch {
    return null; // missing key / tampered / network — caller proceeds without the cred
  }
}

/** Which tool ids currently have a stored credential (for the /admin status UI). */
export async function listCredentialedToolIds(agentId: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin().from(TABLE).select('tool_id').eq('agent_id', agentId);
    if (error || !Array.isArray(data)) return [];
    return data.map((r) => (r as { tool_id: string }).tool_id).filter(Boolean);
  } catch {
    return [];
  }
}
