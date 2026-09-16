import { MongoClient, ObjectId } from "mongodb";
import type { Env, MemoryDoc } from "./types";
import { TENANT_ID } from "./types";

/**
 * Name of the Atlas Search vector index this collection already has, created by
 * my_chatgpt. Atlas M0 caps a cluster at 3 search indexes total and all 3 are already
 * in use, so this repo does NOT create its own index — it reuses this one, the same way
 * Jarvis reuses it under tenant `$~jarvis`. VERIFY this name (and the embedded field name
 * below) against the live index definition before the first real write — it was not
 * possible to confirm from this session (Atlas MCP access is disabled for the account,
 * and a same-day attempt to read it from the Jarvis VM script failed on env loading).
 */
const VECTOR_INDEX_NAME = "vector_index_user";
const EMBEDDING_FIELD = "embedding";

// A fresh client per request, matching Cloudflare's own MongoDB integration example.
// An earlier version cached the client across requests via a module-scoped variable -
// that breaks, silently: Cloudflare's docs are explicit that "TCP sockets cannot be
// created in global scope and shared across requests." A socket surviving from a prior
// request gets torn down by the runtime, and the driver reusing that dead reference
// produces no error at all - just a hang until serverSelectionTimeoutMS fires (this is
// exactly what a live "type=Unknown, error=none" per-server timeout turned out to be).
// A Durable-Object-backed connection pool is the correct way to get reuse back, if
// per-request connect latency ever becomes a real problem - see README.
async function getClient(env: Env): Promise<MongoClient> {
  const client = new MongoClient(env.MONGODB_ATLAS_URI, {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    maxIdleTimeMS: 20_000,
  });
  await client.connect();
  return client;
}

async function getCollection(env: Env) {
  const client = await getClient(env);
  return client.db(env.MONGODB_DB).collection<MemoryDoc>(env.MONGODB_COLLECTION);
}

/** Vector search scoped to this app's own tenant only — never sees another tenant's docs. */
export async function searchSimilar(
  env: Env,
  vector: number[],
  limit = 5
): Promise<(MemoryDoc & { _id: string; score: number })[]> {
  const col = await getCollection(env);
  const results = await col
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: EMBEDDING_FIELD,
          queryVector: vector,
          numCandidates: Math.max(limit * 10, 50),
          limit,
          filter: { userId: TENANT_ID },
        },
      },
      { $set: { score: { $meta: "vectorSearchScore" } } },
    ])
    .toArray();
  return results.map((r) => ({ ...(r as MemoryDoc), _id: String(r._id), score: r.score }));
}

export async function listRecent(env: Env, limit = 100): Promise<(MemoryDoc & { _id: string })[]> {
  const col = await getCollection(env);
  const docs = await col
    .find({ userId: TENANT_ID })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({ ...d, _id: String(d._id) }));
}

export async function insertFact(
  env: Env,
  fact: { topic: string; summary: string; tags: string[]; domain: string },
  embedding: number[]
): Promise<string> {
  const col = await getCollection(env);
  const now = new Date().toISOString();
  const doc: MemoryDoc = {
    userId: TENANT_ID,
    topic: fact.topic,
    summary: fact.summary,
    tags: fact.tags,
    domain: fact.domain,
    embedding,
    source: "memory-diary",
    createdAt: now,
    updatedAt: now,
  };
  const result = await col.insertOne(doc as MemoryDoc);
  return String(result.insertedId);
}

/** Every mutation re-checks `userId: TENANT_ID` in its filter, so an id from another
 * tenant (or a bug elsewhere) can never be edited or deleted through this app. */
export async function updateFact(
  env: Env,
  id: string,
  fact: { topic: string; summary: string; tags: string[]; domain: string },
  embedding: number[]
): Promise<boolean> {
  const col = await getCollection(env);
  const result = await col.updateOne(
    { _id: new ObjectId(id), userId: TENANT_ID },
    {
      $set: {
        topic: fact.topic,
        summary: fact.summary,
        tags: fact.tags,
        domain: fact.domain,
        embedding,
        updatedAt: new Date().toISOString(),
      },
    }
  );
  return result.matchedCount > 0;
}

export async function deleteFact(env: Env, id: string): Promise<boolean> {
  const col = await getCollection(env);
  const result = await col.deleteOne({ _id: new ObjectId(id), userId: TENANT_ID });
  return result.deletedCount > 0;
}
