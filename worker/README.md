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

**Verified live 2026-09-17**: `VECTOR_INDEX_NAME = "vector_index_user"` and
`EMBEDDING_FIELD = "embedding"` in `src/db.ts` are correct — confirmed end-to-end with a
real create → vector-search-based correction → delete cycle against the live cluster
(the "update" path only works at all if the index/field names are right, since it
depends on `$vectorSearch` finding the prior entry).

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

## Connection pattern, and the wrangler-version trap that broke it

A fresh `MongoClient` per request (`src/db.ts`) — no caching/reuse across requests
(Cloudflare's docs are explicit that TCP sockets "cannot be created in global scope and
shared across requests," so this is correct regardless of the story below).

**The actual root cause of a first-deploy failure, for the record**, because it cost a
long debugging session and is easy to reintroduce: **`wrangler` must be on v4
(`^4.4.0`+), not v3.** With `wrangler@3.114.17`, every request hung for exactly
`serverSelectionTimeoutMS` with `MongoServerSelectionError` and every shard member stuck
at `type=Unknown, error=none` — not a rejection, a connect that never resolves and never
errors. Ruled out, in order, with live evidence at each step: Atlas Network Access
(`0.0.0.0/0` was already set), cluster health (not paused), module-scoped client caching
(removed it, no change), `nodejs_compat_v2` vs `nodejs_compat` (no change),
`compatibility_date` (matched a known-working public reference exactly, no change),
`mongodb` driver version pinned to that same reference's `6.15.0` (no change). What
*did* change it: a raw `cloudflare:sockets` `connect()` with `secureTransport: "on"` to
the identical Atlas host:port succeeded in under 500ms even while the driver hung,
proving the network/TLS path itself was fine and the driver's own socket handling
wasn't. The one remaining difference from the known-working reference was its
`wrangler` major version (`^4.4.0` vs this repo's original `^3.90.0`) — bumping it
fixed the connection immediately. Wrangler 3's bundler evidently produces a broken
`node:tls`/`unenv` shim for the driver's TLS-socket-upgrade pattern specifically; v4's
does not. (Bumping wrangler also raises its Node requirement to >= 22 — see
`.github/workflows/deploy-worker.yml`'s `setup-node` step.)

If per-request connect latency becomes a real problem, the next step is a
Durable-Object-backed connection pool (one persistent Mongo connection per DO
instance, which Cloudflare's own docs also cover) - not a module-scoped cache.

## Deployment

Only through `.github/workflows/deploy-worker.yml` — never `wrangler deploy` by hand
outside CI (governance's DEPLOYMENT.md: every surface deploys through a committed
workflow).
