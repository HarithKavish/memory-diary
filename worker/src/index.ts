import type { Env } from "./types";
import { checkPassphrase, issueSessionToken, requireAuth } from "./auth";
import { deleteFact, insertFact, listRecent, searchSimilar, updateFact } from "./db";
import { embedText } from "./embed";
import { extractFact } from "./llm";

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
          const results = await searchSimilar(env, vector, 20);
          return json({ entries: results });
        }
        const entries = await listRecent(env);
        return json({ entries });
      }

      if (pathname === "/entries" && request.method === "POST") {
        const { text } = (await request.json()) as { text?: string };
        if (!text || !text.trim()) return json({ error: "text is required" }, 400);

        const queryVector = await embedText(env, text);
        const candidates = await searchSimilar(env, queryVector, 5);
        const decision = await extractFact(env, text, candidates);

        if (decision.action === "noop") {
          return json({ action: "noop", reason: decision.reason ?? "not a storable fact" });
        }

        if (decision.action === "delete") {
          if (!decision.matchId) return json({ error: "delete decided with no matchId" }, 422);
          const deleted = await deleteFact(env, decision.matchId);
          return json({ action: "delete", id: decision.matchId, deleted, reason: decision.reason });
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
        return deleted ? json({ ok: true }) : json({ error: "not found" }, 404);
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
