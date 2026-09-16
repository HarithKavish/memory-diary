# memory-diary

A personal "brain": an Android app for jotting free-form facts about yourself, and a small
AI backend that turns them into structured, searchable, correctable entries in a shared
vector database — so other AI systems (Jarvis, my_chatgpt) can read the same canonical
profile directly.

- **Where it lives:** no public web surface. The Android app is distributed as a GitHub
  Release APK; the backend is a private Cloudflare Worker.
- **How to run it:**
  - Backend: `cd worker && npm install && npx wrangler dev` (needs Worker secrets set locally
    via `wrangler secret put` — see `worker/README.md`).
  - App: `cd app && flutter run --dart-define=API_BASE_URL=<your worker dev URL>`.
  - Or just download the latest APK from [Releases](../../releases) and point it at the
    deployed Worker.
- **Ecosystem membership:** this repository is part of the HarithKavish ecosystem — see
  [GOVERNANCE.md](GOVERNANCE.md) and [AGENTS.md](AGENTS.md).

## How it works

1. You type something in the app — a new fact, or a correction to one already stored.
2. The Worker sends it to an LLM, which decides: new fact, or an edit/delete of an existing
   one (after a vector search against your own entries to find what's being corrected).
3. The (possibly updated) fact is embedded and written to MongoDB Atlas, in the `talk.memories`
   collection Jarvis and my_chatgpt already use, under the tenant `userId: "harith"` — see
   [worker/README.md](worker/README.md) for why it's a shared collection and not a dedicated one.
4. Any system with read access to that tenant sees the change immediately.

See [worker/README.md](worker/README.md) and [app/README.md](app/README.md) for the two
components' own details.
