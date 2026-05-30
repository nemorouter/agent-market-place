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

export async function retrieve(query: string, embeddingModel: string, topK: number): Promise<Chunk[]> {
  const [vector] = await embed(embeddingModel, [query]);
  const db = supabaseAdmin();
  // match_chunks() is defined in supabase/migration.sql (cosine distance over pgvector).
  const { data, error } = await db.rpc('match_chunks', {
    query_embedding: vector as unknown as string,
    match_count: topK,
  });
  if (error) throw new Error(`retrieval failed: ${error.message}`);
  return (data || []) as Chunk[];
}
