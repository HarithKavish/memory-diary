/**
 * Question wrappers ("what do you know about my ...") carry almost no topic signal but
 * dominate a short query's embedding: live, every personal fact scored ~0.57-0.58 for
 * "what do you know about my school education" so the education fact fell below rank 10,
 * while the bare "my school education" ranked it 3rd. Stripping these gives a second,
 * topic-only query to search alongside the original.
 */
const FILLER = new Set([
  "what", "whats", "who", "whom", "where", "when", "which", "how", "why",
  "do", "does", "did", "is", "are", "was", "were", "am", "be", "been",
  "you", "your", "yours", "i", "me", "my", "mine", "we", "our", "us",
  "know", "knows", "knew", "remember", "recall", "tell", "show", "give", "list", "say",
  "about", "regarding", "of", "on", "the", "a", "an", "any", "all", "some",
  "have", "has", "had", "can", "could", "would", "should", "will", "please", "there",
  "info", "information", "details", "stored", "saved", "record", "records",
]);

/** Returns the topic-only form of `text`, or null when stripping leaves nothing usable
 * or changes nothing (so callers skip a pointless second search). */
export function focusQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((t) => !FILLER.has(t));
  if (kept.length === 0 || kept.length === tokens.length) return null;
  return kept.join(" ");
}

/** Merge two candidate lists by id, keeping each entry's best score. */
export function mergeByBestScore<T extends { _id: string; score: number }>(...lists: T[][]): T[] {
  const best = new Map<string, T>();
  for (const item of lists.flat()) {
    const seen = best.get(item._id);
    if (!seen || item.score > seen.score) best.set(item._id, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
