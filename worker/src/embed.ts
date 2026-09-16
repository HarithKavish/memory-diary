import type { Env } from "./types";

/**
 * 384-dim, matching the shared `vector_index_user` index exactly — Jarvis's memory notes
 * that a dimension mismatch produces silently garbage retrieval rather than an error, so
 * this model is not swappable without also rebuilding the index.
 */
const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";

export async function embedText(env: Env, text: string): Promise<number[]> {
  const result = (await env.AI.run(EMBEDDING_MODEL, { text: [text] })) as {
    data: number[][];
  };
  const vector = result.data[0];
  if (!vector || vector.length !== 384) {
    throw new Error(
      `embedding came back with ${vector?.length ?? 0} dims, expected 384 — index mismatch`
    );
  }
  return vector;
}
