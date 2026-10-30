# Governance

This repository is part of the **HarithKavish ecosystem** and is governed by
[HarithKavish Governance](https://github.com/HarithKavish/harithkavish-governance).

Governance is read from that repository. It is not copied here.

## Start here

Agents: read [AGENTS.md](AGENTS.md) first, then follow
[AGENT_BOOTSTRAP.md](https://github.com/HarithKavish/harithkavish-governance/blob/main/AGENT_BOOTSTRAP.md).

## This repository

- **Role:** application (mobile app + backing service)
- **Surface:** none (private-use Android app; backend is a Cloudflare Worker with no public UI)
- **Production branch:** `main`
- **Development branch:** `development`
- **Last verified against governance:** 2026-09-16T00:00:00Z

## Especially applicable

- [REPOSITORY](https://github.com/HarithKavish/harithkavish-governance/blob/main/standards/REPOSITORY.md)
- [BRANCHING](https://github.com/HarithKavish/harithkavish-governance/blob/main/standards/BRANCHING.md)
- [DEVELOPMENT](https://github.com/HarithKavish/harithkavish-governance/blob/main/standards/DEVELOPMENT.md)
- [SECURITY](https://github.com/HarithKavish/harithkavish-governance/blob/main/standards/SECURITY.md)
- [DEPLOYMENT](https://github.com/HarithKavish/harithkavish-governance/blob/main/standards/DEPLOYMENT.md)

## Declared exceptions

- This repository writes into `talk.memories`, a MongoDB Atlas collection owned and
  primarily used by `my_chatgpt` (shared because Atlas M0 caps search indexes at 3,
  already exhausted by `my_chatgpt`). `memory-diary` uses its own tenant (`userId: "harith"`)
  within that collection, and also writes to the shared `world` section and to
  dynamically-created `@<person>` sections (one per person Harith knows). Reads span the
  fixed allowlist (`harith`, `$~jarvis`, `world`, owner's `my_chatgpt` account) plus any
  discovered person sections. See `worker/README.md`.
- No social preview image has been created yet for this repository. To be added.
