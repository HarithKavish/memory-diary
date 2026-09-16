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
}

export interface ExtractionResult {
  action: "create" | "update" | "delete" | "noop";
  matchId?: string;
  reason?: string;
  fact?: {
    topic: string;
    summary: string;
    tags: string[];
    domain: string;
  };
}
