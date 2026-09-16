# memory-diary worker

Cloudflare Worker backend. Holds every credential this app uses; the Android app holds none.

## Why it writes into someone else's collection

Atlas is on the M0 free tier, which allows only **3 search indexes per cluster** — all
three already belong to `my_chatgpt`. This repo does not create a 4th; it reuses
`my_chatgpt`'s `vector_index_user` index on the `talk.memories` collection, exactly the way
Jarvis already does as tenant `$~jarvis` (see `TENANT_FIELD = "userId"` in
`hermes-agent/tools/atlas_memory.py` on the Jarvis VM). Agent tenants there are prefixed
`$~`; this app uses the plain tenant `userId: "harith"` — the human-authored section other
systems can read as the canonical profile, as opposed to any agent's own derived memories.

**Every query and mutation in `src/db.ts` filters or matches on `userId: "harith"`.** It
never reads, searches, or writes another tenant's documents.

**Before the first real write**, confirm two things live (this could not be confirmed from
the session that built this — Atlas MCP access is disabled for the account, and the
VM-side `atlas_memory.py` needs its `.env` properly sourced to connect):
- the search index name really is `vector_index_user` (`src/db.ts`, `VECTOR_INDEX_NAME`)
- the embedded vector field is really named `embedding` (`src/db.ts`, `EMBEDDING_FIELD`)

If either differs, update the constants in `src/db.ts` — a dimension or path mismatch fails
silently with garbage results, not an error.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /auth/login` | passphrase in body | exchange the owner passphrase for a session JWT |
| `POST /entries` | Bearer JWT | free text in; LLM decides create/update/delete/noop |
| `GET /entries?q=` | Bearer JWT | list recent facts, or vector-search with `q` |
| `PATCH /entries/:id` | Bearer JWT | direct manual edit, bypassing the LLM |
| `DELETE /entries/:id` | Bearer JWT | direct manual delete |

## Secrets

Never set in `wrangler.toml` or any committed file. Set with `wrangler secret put <NAME>`
(interactively) or `secretctl push -Target wrangler:memory-diary-worker -EnvName <NAME>`:

`MONGODB_ATLAS_URI`, `MONGODB_DB`, `MONGODB_COLLECTION`, `LLM_API_KEY`, `LLM_MODEL`,
`JWT_SIGNING_KEY`, `OWNER_PASSPHRASE`. See `.dev.vars.example` for local dev.

## Local dev

```
npm install
cp .dev.vars.example .dev.vars   # fill in real values, never commit this file
npx wrangler dev
```

## Connection pattern

A fresh `MongoClient` per request (`src/db.ts`) — no caching/reuse across requests.
**This was not the first version.** An earlier version cached the client in a
module-scoped variable to reuse across warm invocations, which broke silently in
production: Cloudflare's docs are explicit that TCP sockets "cannot be created in
global scope and shared across requests." A socket surviving from a prior request gets
torn down by the runtime, and the driver reusing that dead reference produces no error
at all - just a hang until `serverSelectionTimeoutMS` fires. Diagnosed live via
`wrangler tail --format json` plus logging `err.reason.servers` (a
`MongoServerSelectionError`'s real per-server detail, not `.cause`), which showed every
shard member stuck at `type=Unknown, error=none` - a connect that never resolves and
never errors, not a rejection.

If per-request connect latency becomes a real problem, the correct fix is a
Durable-Object-backed connection pool (one persistent Mongo connection per DO
instance, which Cloudflare's own docs also cover) - not a module-scoped cache.

## Deployment

Only through `.github/workflows/deploy-worker.yml` — never `wrangler deploy` by hand
outside CI (governance's DEPLOYMENT.md: every surface deploys through a committed
workflow).
