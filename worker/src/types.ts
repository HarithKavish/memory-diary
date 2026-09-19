export interface Env {
  AI: Ai;
  MONGODB_ATLAS_URI: string;
  MONGODB_DB: string;
  MONGODB_COLLECTION: string;
  LLM_API_KEY: string;
  LLM_MODEL: string;
  JWT_SIGNING_KEY: string;
  OWNER_PASSPHRASE: string;
}

/** The tenant this app owns inside the shared `talk.memories` collection. Every WRITE
 * (insert/update/delete) is scoped to this tenant only. */
export const TENANT_ID = "harith";

/**
 * Tenants this app READS from, in addition to its own - the same three the Jarvis
 * agent's recall() now searches, so there is one consistent view of what is known
 * about the owner regardless of which system learned it:
 *  - TENANT_ID: this app's own canonical profile.
 *  - "$~jarvis": the Jarvis agent's tenant.
 *  - the owner's own my_chatgpt account (users.username = "harithkavish", looked up
 *    directly in the `users` collection, not guessed). This is where most of the
 *    owner's personal info already lives - memory-diary reporting "no record" for
 *    things like name/education/parents was because it never searched here.
 * Deliberately a fixed allowlist, not "all tenants": talk.memories also holds other
 * my_chatgpt users' private data, which must never be readable from here.
 */
export const READ_TENANT_IDS = [TENANT_ID, "$~jarvis", "69ad9e8a3c88f37edc71a50f"];

// No `_id` field here deliberately - the mongodb driver adds it automatically as
// ObjectId via WithId<MemoryDoc> on anything read back, and OptionalId<MemoryDoc> on
// insert. Declaring our own `_id` here fights that inference instead of using it.
export interface MemoryDoc {
  userId: string;
  topic: string;
  summary: string;
  tags: string[];
  domain: string;
  embedding: number[];
  source: "memory-diary";
  createdAt: string;
  updatedAt: string;
  /** Present only for image entries: the GridFS file id (in the `images` bucket, same
   * database, separate from `talk.memories`) holding the actual image bytes. GridFS
   * rather than a Cloudflare storage product deliberately - Atlas M0 is a hard-capped
   * free tier that simply refuses writes once full, never auto-charges; R2 requires an
   * account-level opt-in that explicitly warns about overage billing. `topic`/`summary`
   * hold a caption generated at upload time, embedded like any other fact, so the same
   * retrieve/update/delete flow finds and manages images too. */
  imageKey?: string;
  imageContentType?: string;
}

export interface ExtractionResult {
  action: "create" | "update" | "delete" | "retrieve" | "noop";
  /** update/delete: which single existing entry this refers to. */
  matchId?: string;
  /** retrieve: every existing entry (from the candidates already searched) that
   * actually answers the question - zero or more. */
  matchIds?: string[];
  reason?: string;
  fact?: {
    topic: string;
    summary: string;
    tags: string[];
    domain: string;
  };
}
