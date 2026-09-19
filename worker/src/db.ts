import { GridFSBucket, MongoClient, ObjectId } from "mongodb";
import type { Env, MemoryDoc } from "./types";
import { READ_TENANT_IDS, TENANT_ID } from "./types";

/** Separate GridFS bucket (backed by `images.files`/`images.chunks` collections) in the
 * same database - image bytes never touch the shared `talk.memories` collection other
 * tenants read. See the imageKey doc comment in types.ts for why GridFS over a
 * Cloudflare storage product. */
const IMAGE_BUCKET_NAME = "images";

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

async function getImageBucket(env: Env) {
  const client = await getClient(env);
  return new GridFSBucket(client.db(env.MONGODB_DB), { bucketName: IMAGE_BUCKET_NAME });
}

/** Buffers the whole image in memory rather than streaming - personal photos are a few
 * MB at most, and Workers' fetch Response wants a Web ReadableStream while GridFS gives
 * a Node one, so buffering sidesteps that conversion entirely. Returns the GridFS file
 * id (as a string) to store as `imageKey`. */
export async function uploadImage(
  env: Env,
  bytes: ArrayBuffer,
  filename: string,
  contentType: string
): Promise<string> {
  const bucket = await getImageBucket(env);
  const uploadStream = bucket.openUploadStream(filename, { contentType });
  await new Promise<void>((resolve, reject) => {
    uploadStream.on("finish", () => resolve());
    uploadStream.on("error", reject);
    uploadStream.end(Buffer.from(bytes));
  });
  return String(uploadStream.id);
}

export async function downloadImage(
  env: Env,
  fileId: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const bucket = await getImageBucket(env);
  const files = await bucket.find({ _id: new ObjectId(fileId) }).toArray();
  const file = files[0];
  if (!file) return null;

  const chunks: Buffer[] = [];
  const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));
  for await (const chunk of downloadStream) {
    chunks.push(chunk as Buffer);
  }
  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    contentType: (file.contentType as string | undefined) ?? "application/octet-stream",
  };
}

/** Vector search across READ_TENANT_IDS only (a fixed allowlist - never other users'
 * tenants). Mutations below stay scoped to this app's own tenant regardless.
 *
 * `limitPerTenant` is per tenant, not overall: each tenant is searched separately and the
 * results merged by score. A single search over all three let one tenant's long
 * behavioural notes (scoring ~0.70 against almost anything) fill every slot and rank out
 * another tenant's precise facts (~0.60) - e.g. an education fact that clearly exists
 * never reached the LLM. One connection, searches run in parallel. */
export async function searchSimilar(
  env: Env,
  vector: number[],
  limitPerTenant = 5
): Promise<(MemoryDoc & { _id: string; score: number })[]> {
  const col = await getCollection(env);
  const perTenant = await Promise.all(
    READ_TENANT_IDS.map((tenant) =>
      col
        .aggregate([
          {
            $vectorSearch: {
              index: VECTOR_INDEX_NAME,
              path: EMBEDDING_FIELD,
              queryVector: vector,
              numCandidates: Math.max(limitPerTenant * 10, 50),
              limit: limitPerTenant,
              filter: { userId: tenant },
            },
          },
          { $set: { score: { $meta: "vectorSearchScore" } } },
        ])
        .toArray()
    )
  );
  return perTenant
    .flat()
    .map((r) => ({ ...(r as MemoryDoc), _id: String(r._id), score: r.score as number }))
    .sort((a, b) => b.score - a.score);
}

export async function listRecent(env: Env, limit = 100): Promise<(MemoryDoc & { _id: string })[]> {
  const col = await getCollection(env);
  const docs = await col
    .find({ userId: { $in: READ_TENANT_IDS } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({ ...d, _id: String(d._id) }));
}

export async function insertFact(
  env: Env,
  fact: { topic: string; summary: string; tags: string[]; domain: string },
  embedding: number[],
  image?: { key: string; contentType: string }
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
    ...(image ? { imageKey: image.key, imageContentType: image.contentType } : {}),
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

/** Deletes the Mongo doc, and if it was an image entry, its GridFS file too - an image
 * entry deleted through this app never leaves an orphaned blob behind. Returns the
 * deleted entry's own fields (minus the embedding) so the caller can show what was
 * actually removed, not just an id. */
export async function deleteFact(
  env: Env,
  id: string
): Promise<(Omit<MemoryDoc, "embedding"> & { _id: string }) | null> {
  const col = await getCollection(env);
  const deleted = await col.findOneAndDelete({ _id: new ObjectId(id), userId: TENANT_ID });
  if (!deleted) return null;
  if (deleted.imageKey) {
    const bucket = await getImageBucket(env);
    await bucket.delete(new ObjectId(deleted.imageKey));
  }
  const { embedding: _embedding, _id, ...rest } = deleted;
  return { ...rest, _id: String(_id) };
}
