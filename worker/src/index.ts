import type { Env } from "./types";
import { checkPassphrase, issueSessionToken, requireAuth } from "./auth";
import { deleteFact, downloadImage, insertFact, listRecent, searchSimilar, updateFact, uploadImage } from "./db";
import { embedText } from "./embed";
import { extractFact, structureCaption } from "./llm";
import { focusQuery, mergeByBestScore } from "./query";
import { captionImage } from "./vision";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/auth/login" && request.method === "POST") {
        const { passphrase } = (await request.json()) as { passphrase?: string };
        if (!passphrase || !checkPassphrase(passphrase, env)) {
          return json({ error: "invalid passphrase" }, 401);
        }
        const token = await issueSessionToken(env);
        return json({ token });
      }

      const authError = await requireAuth(request, env);
      if (authError) return authError;

      if (pathname === "/entries" && request.method === "GET") {
        const q = url.searchParams.get("q");
        if (q) {
          const vector = await embedText(env, q);
          const results = await searchSimilar(env, vector, 10);
          return json({ entries: results });
        }
        const entries = await listRecent(env);
        return json({ entries });
      }

      if (pathname === "/entries" && request.method === "POST") {
        const { text } = (await request.json()) as { text?: string };
        if (!text || !text.trim()) return json({ error: "text is required" }, 400);

        const queryVector = await embedText(env, text);
        // Search with the raw text AND its topic-only form (question wrappers stripped) -
        // see query.ts for why the wrapper words alone can rank a real answer out.
        const focus = focusQuery(text);
        const [primary, focused] = await Promise.all([
          searchSimilar(env, queryVector, 8),
          // best-effort second pass: if it fails, the primary search alone still answers
          focus
            ? embedText(env, focus).then((v) => searchSimilar(env, v, 8)).catch(() => [])
            : Promise.resolve([]),
        ]);
        const candidates = mergeByBestScore(primary, focused);
        const decision = await extractFact(env, text, candidates);

        if (decision.action === "noop") {
          return json({ action: "noop", reason: decision.reason ?? "not a storable fact" });
        }

        if (decision.action === "retrieve") {
          // No extra DB round trip: the LLM picked matchIds from the candidates we
          // already fetched, so just filter and return their actual stored fields -
          // never LLM-synthesized prose, the app renders these as key/value pairs.
          const matchIds = new Set(decision.matchIds ?? []);
          const entries = candidates
            .filter((c) => matchIds.has(c._id))
            .map(({ embedding: _embedding, ...rest }) => rest);
          return json({ action: "retrieve", entries, reason: decision.reason });
        }

        if (decision.action === "delete") {
          if (!decision.matchId) return json({ error: "delete decided with no matchId" }, 422);
          const deleted = await deleteFact(env, decision.matchId);
          return json({
            action: "delete",
            id: decision.matchId,
            deleted: deleted !== null,
            fact: deleted,
            reason: decision.reason,
          });
        }

        if (!decision.fact) return json({ error: "extraction returned no fact" }, 422);
        const factVector = await embedText(env, `${decision.fact.topic}: ${decision.fact.summary}`);

        if (decision.action === "update") {
          if (!decision.matchId) return json({ error: "update decided with no matchId" }, 422);
          const updated = await updateFact(env, decision.matchId, decision.fact, factVector);
          return json({ action: "update", id: decision.matchId, updated, fact: decision.fact });
        }

        const id = await insertFact(env, decision.fact, factVector);
        return json({ action: "create", id, fact: decision.fact });
      }

      if (pathname === "/images" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("image");
        if (!(file instanceof File)) return json({ error: "image field is required" }, 400);

        const bytes = await file.arrayBuffer();
        const contentType = file.type || "application/octet-stream";
        const key = await uploadImage(env, bytes, file.name || "upload", contentType);

        const caption = await captionImage(env, bytes);
        const fact = await structureCaption(env, caption);
        const vector = await embedText(env, `${fact.topic}: ${fact.summary}`);
        const id = await insertFact(env, fact, vector, { key, contentType });
        // imageKey nested inside fact, not a sibling - every other response shape
        // (create/update/retrieve) carries an entry's fields inside "fact"/"entries",
        // and the client's Entry-building logic only looks there.
        return json({ action: "create", id, fact: { ...fact, imageKey: key } });
      }

      const imageKeyMatch = pathname.match(/^\/images\/([a-fA-F0-9]{24})$/);
      if (imageKeyMatch && request.method === "GET") {
        const image = await downloadImage(env, imageKeyMatch[1]);
        if (!image) return json({ error: "not found" }, 404);
        return new Response(image.bytes, {
          headers: { "content-type": image.contentType },
        });
      }

      const entryIdMatch = pathname.match(/^\/entries\/([a-fA-F0-9]{24})$/);
      if (entryIdMatch && request.method === "PATCH") {
        const id = entryIdMatch[1];
        const fact = (await request.json()) as {
          topic: string;
          summary: string;
          tags: string[];
          domain: string;
        };
        const vector = await embedText(env, `${fact.topic}: ${fact.summary}`);
        const updated = await updateFact(env, id, fact, vector);
        return updated ? json({ ok: true }) : json({ error: "not found" }, 404);
      }

      if (entryIdMatch && request.method === "DELETE") {
        const deleted = await deleteFact(env, entryIdMatch[1]);
        return deleted ? json({ ok: true, fact: deleted }) : json({ error: "not found" }, 404);
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      // Logged in full (network/protocol detail only, no credentials) because Workers
      // swallows uncaught detail otherwise - `wrangler tail` only shows an explicit
      // console.error, not the exception object itself.
      console.error("request failed:", err);
      // MongoServerSelectionError carries the real per-server reason in
      // `.reason.servers` (a Map), not `.cause` - that's what actually explains a
      // connection failure like this one.
      const e = err as {
        message?: string;
        name?: string;
        reason?: { servers?: Map<string, { type?: string; error?: { message?: string; code?: unknown } }> };
      };
      const serverErrors: Record<string, string> = {};
      if (e?.reason?.servers) {
        for (const [addr, desc] of e.reason.servers) {
          serverErrors[addr] = `type=${desc?.type ?? "?"} error=${desc?.error?.message ?? "none"} code=${String(desc?.error?.code ?? "")}`;
        }
      }
      const detail =
        err instanceof Error
          ? { message: e.message, name: e.name, serverErrors }
          : { message: "internal error" };
      return json({ error: detail }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
