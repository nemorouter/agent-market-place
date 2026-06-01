// lib/retrieval.ts — semantic search over the customer's pgvector KB.
//
// EXTENSION POINT: add metadata filters, hybrid (keyword + vector) search, or
// re-ranking here without touching the chat route.
import { embed } from './nemo';
import { supabaseAdmin } from './supabase';

export interface Chunk {
  id: string;
  title: string;
  url: string | null;
  content: string;
  similarity: number;
}

export async function retrieve(
  query: string,
  embeddingModel: string,
  topK: number,
  /** Optional entitlement tags from the signed-in user, e.g. ["public","pro"].
   *  When set, only chunks whose `audiences` overlap are returned (see migration.sql).
   *  Omitted/undefined → unscoped (the default, anonymous behavior). */
  audiences?: string[],
): Promise<Chunk[]> {
  const [vector] = await embed(embeddingModel, [query]);
  const db = supabaseAdmin();
  // match_chunks() is defined in supabase/migration.sql (cosine distance over pgvector).
  // The audience-scoped overload accepts match_audiences; passing null = unscoped.
  const { data, error } = await db.rpc('match_chunks', {
    query_embedding: vector as unknown as string,
    match_count: topK,
    match_audiences: audiences && audiences.length ? audiences : null,
  });
  if (error) throw new Error(`retrieval failed: ${error.message}`);
  return (data || []) as Chunk[];
}
