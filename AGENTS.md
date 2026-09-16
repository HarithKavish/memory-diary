# Agent Instructions

This repository is part of the **HarithKavish ecosystem**.

**Before changing anything**, read
[AGENT_BOOTSTRAP.md](https://github.com/HarithKavish/harithkavish-governance/blob/main/AGENT_BOOTSTRAP.md)
and follow it. See [GOVERNANCE.md](GOVERNANCE.md) for what governs this repository.

Do not begin implementation work before discovery is complete.

## Hard stops

A reminder, not the rule. These restate doctrine articles so an agent that reads nothing
else still has the guardrails. Governance is authoritative; if these ever disagree with
it, governance wins.

- Do not commit to the production branch (Article 6).
- Do not commit secrets or credentials (Article 5, SECURITY).
- Do not redefine design foundations locally (Article 4).
- Do not copy governance or the design system into this repository (Article 3).
- Do not act outside the scope you were given (Article 9).

## About this repository

`memory-diary` is a personal "brain": an Android app (`app/`) where the owner types
free-form facts about themselves, and a Cloudflare Worker (`worker/`) that uses an LLM to
extract or correct structured facts and writes them into MongoDB Atlas — the same
`talk.memories` collection Jarvis and `my_chatgpt` already share, under its own tenant
(`userId: "harith"`). Other systems in the ecosystem read that tenant directly as the
canonical, human-authored profile section, distinct from any agent's own derived memories.

## Working here

- All credentials (Mongo URI, LLM key, JWT signing key, owner passphrase) are Cloudflare
  Worker secrets, set via `wrangler secret put` (or `secretctl push -Target wrangler:...`).
  **None of them are ever compiled into the Android app** — the app is public and
  decompilable, so it holds only the Worker's public base URL.
- `worker/` deploys only through `.github/workflows/deploy-worker.yml`. Do not
  `wrangler deploy` by hand outside that workflow (DEPLOYMENT.md).
- `app/` builds only through `.github/workflows/build-apk.yml`. A tagged push produces a
  GitHub Release with the APK attached.
- The Mongo tenant this repo owns is `userId: "harith"` in `talk.memories`. Never write to,
  filter out, or otherwise touch `$~jarvis` or any other tenant's documents — see
  `worker/README.md` for the shared-collection convention this depends on.
- No disk-space-heavy local tooling (`npm install`, `flutter create`) has been run or
  verified locally in this repository's early history — the development machine was out of
  disk space at the time. Treat CI (`build-apk.yml` / `deploy-worker.yml` runs) as the
  first real build verification until told otherwise; do not assume local commands here
  have been tested.
