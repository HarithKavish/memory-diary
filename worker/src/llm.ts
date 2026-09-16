import type { Env, ExtractionResult, MemoryDoc } from "./types";

const SYSTEM_PROMPT = `You maintain a small, structured personal-facts database for one person.
You will be given the person's new free-text message and a list of their existing stored
facts that are semantically closest to it (may be empty).

Decide exactly one action and reply with ONLY a JSON object, no prose, matching this shape:

{
  "action": "create" | "update" | "delete" | "noop",
  "matchId": "<id of the existing fact this refers to, required for update/delete>",
  "reason": "<one short sentence explaining the decision, for logging>",
  "fact": { "topic": "...", "summary": "...", "tags": ["..."], "domain": "..." }
}

Rules:
- "update": the message corrects or adds detail to something already stored (e.g. "actually
  my sister's name is Meera, not Maya"). Set matchId to the existing fact being corrected,
  and "fact" to its new, corrected content in full (not just the diff).
- "delete": the message says something stored is no longer true and should simply be
  removed, with no replacement fact. Set matchId, omit "fact".
- "create": a genuinely new fact with no close existing match.
- "noop": the message isn't a storable personal fact at all (a question, small talk, etc).
  Omit matchId and fact.
- "domain" is a short category like "family", "work", "health", "preferences", "contact".
- "tags" is 2-5 short lowercase keywords.
- Never invent a matchId that wasn't in the candidate list.`;

export async function extractFact(
  env: Env,
  text: string,
  candidates: (MemoryDoc & { _id: string; score: number })[]
): Promise<ExtractionResult> {
  const candidateBlock = candidates.length
    ? candidates
        .map((c) => `- id=${c._id} (similarity ${c.score.toFixed(3)}): ${c.topic} — ${c.summary}`)
        .join("\n")
    : "(none)";

  const userPrompt = `New message: "${text}"\n\nExisting close matches:\n${candidateBlock}`;

  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM extraction failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = body.choices[0]?.message?.content ?? "{}";

  let parsed: ExtractionResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${content}`);
  }
  return parsed;
}
