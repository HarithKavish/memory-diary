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

/** The tenant this app owns inside the shared `talk.memories` collection. */
export const TENANT_ID = "harith";

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
