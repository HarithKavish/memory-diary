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
 * Tenants this app READS from, in addition to its own - the same set the Jarvis
 * agent's recall() searches, so there is one consistent view of what is known
 * about the owner regardless of which system learned it.
 *
 * As of 2026-09-20 a tenant is a SECTION: what a memory is *about*, rather than
 * which system happened to record it. That is what makes one format work across
 * every current and future system:
 *  - TENANT_ID ("harith"): facts about the owner. This app's own canonical
 *    profile, and the section every system writes the owner's facts to.
 *  - "$~jarvis": facts about the Jarvis agent itself - its identity, architecture
 *    and operating doctrine. Each agent owns a "$~<agent>" section for its own
 *    self-knowledge; a future system adds one without migrating anything.
 *  - WORLD_TENANT_ID ("world"): everything that is about neither the owner nor any
 *    one agent - infrastructure, tooling, how things work. Shared and
 *    system-agnostic, deliberately not "$~"-prefixed because it belongs to no
 *    single agent.
 *  - the owner's own my_chatgpt account (users.username = "harithkavish", looked up
 *    directly in the `users` collection, not guessed). This is where most of the
 *    owner's personal info already lives - memory-diary reporting "no record" for
 *    things like name/education/parents was because it never searched here.
 *
 * Deliberately a fixed allowlist, not "all tenants": talk.memories also holds other
 * my_chatgpt users' private data, which must never be readable from here.
 */
export const WORLD_TENANT_ID = "world";

/** People Harith knows get one section each: "@" + a slug of their name, the way "$~"
 * marks an agent's own section. A fact about a person belongs to that person - "Kevin is
 * 23" goes to `@kevin`, while what lands in `harith` is the relationship ("Kevin is an
 * office friend"). Person sections are discovered at read time rather than listed here,
 * because the set grows as he meets people. */
export const PERSON_PREFIX = "@";

export function personTenant(name: string): string {
  const slug = (name ?? "")
    .replace(/[^\p{L}\p{N} \-_]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toLowerCase();
  if (!slug) throw new Error("person name is empty after normalisation");
  return PERSON_PREFIX + slug;
}

/** Sections this app may WRITE. Deliberately narrower than what it reads: the owner's
 * own section, the shared world section, and any person's section. Never "$~jarvis"
 * (an agent's private self-knowledge, which only that agent should author) and never
 * another my_chatgpt account. */
export function isWritableTenant(tenant: string): boolean {
  return (
    tenant === TENANT_ID ||
    tenant === WORLD_TENANT_ID ||
    tenant.startsWith(PERSON_PREFIX)
  );
}

/** Resolve the classifier's chosen section to the tenant that owns it. */
export function resolveWriteTenant(section?: string, person?: string): string {
  switch ((section ?? "").toLowerCase()) {
    case "world":
      return WORLD_TENANT_ID;
    case "person":
      if (!person) throw new Error("section 'person' requires a person name");
      return personTenant(person);
    default:
      return TENANT_ID;
  }
}

export const READ_TENANT_IDS = [
  TENANT_ID,
  "$~jarvis",
  WORLD_TENANT_ID,
  "69ad9e8a3c88f37edc71a50f",
];

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
    /** Which section this fact belongs to, by who or what it is ABOUT. Defaults to
     * the owner's own section when the classifier omits it. */
    section?: "user" | "world" | "person";
    /** Required when section is "person": whose section this is. */
    person?: string;
  };
}
