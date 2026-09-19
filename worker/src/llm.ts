import type { Env, ExtractionResult, MemoryDoc } from "./types";

const SYSTEM_PROMPT = `You maintain a small, structured personal-facts database for one person.
This also covers image entries the person has uploaded (a caption stored as topic/summary,
exactly like a text fact) - treat them the same as any other entry for matching purposes.
You will be given the person's new free-text message and a list of their existing stored
entries that are semantically closest to it (may be empty).

Decide exactly one action and reply with ONLY a JSON object, no prose, matching this shape:

{
  "action": "create" | "update" | "delete" | "retrieve" | "noop",
  "matchId": "<id of the existing entry this refers to, required for update/delete>",
  "matchIds": ["<id>", ...] (retrieve only - every candidate that actually answers the question),
  "reason": "<one short sentence explaining the decision, for logging>",
  "fact": { "topic": "...", "summary": "...", "tags": ["..."], "domain": "..." }
}

Rules:
- "retrieve": the message is a QUESTION or request to recall something already stored
  (e.g. "what do you know about my school education", "what are my parents' names",
  "show me that photo of my dog") - it is NOT a new fact to save. Set matchIds to every
  candidate whose topic or summary is plausibly ABOUT the subject asked - be inclusive,
  not strict: an entry does not need to phrase itself like the question (a stored
  "Education Institution: <a college>" is relevant to "my school education"; a stored
  surname or nickname is relevant to "my name"). Missing a related entry is worse than
  including a borderline one, since the person reads the results. Exclude only candidates
  that are clearly about something else. Use an empty list only when nothing is related.
  Omit matchId and fact.
- "update": the message corrects or adds detail to something already stored (e.g. "actually
  my sister's name is Meera, not Maya"). Set matchId to the existing entry being corrected,
  and "fact" to its new, corrected content in full (not just the diff).
- "delete": the message says something stored (including an image entry) is no longer
  wanted and should simply be removed, with no replacement. Set matchId, omit "fact".
- "create": a genuinely new fact with no close existing match, and the message is a
  statement, not a question.
- "noop": the message is neither a storable fact, a correction, a deletion, nor a question
  about something stored - e.g. small talk, a greeting, something unrelated entirely. Omit
  matchId, matchIds, and fact.
- "domain" is a short category like "family", "work", "health", "preferences", "contact".
- "tags" is 2-5 short lowercase keywords.
- Never invent an id that wasn't in the candidate list.`;

async function chatJson(env: Env, system: string, user: string): Promise<unknown> {
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
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { choices: { message: { content: string } }[] };
  const content = body.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${content}`);
  }
}

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
  return (await chatJson(env, SYSTEM_PROMPT, userPrompt)) as ExtractionResult;
}

const CAPTION_STRUCTURE_PROMPT = `You are given a detailed caption generated for a photo the
user just uploaded. Turn it into the same structured shape used for text facts. Reply with
ONLY a JSON object:

{ "topic": "short label, e.g. 'photo: birthday cake'", "summary": "<the caption, lightly
cleaned up if needed>", "tags": ["2-5 short lowercase keywords"], "domain": "photos" }

Keep "summary" close to the original caption's actual content - do not invent details that
were not in it.`;

/** Structures an auto-generated image caption into the same topic/summary/tags/domain
 * shape as a text fact, so images and facts render identically in the app. */
export async function structureCaption(
  env: Env,
  caption: string
): Promise<{ topic: string; summary: string; tags: string[]; domain: string }> {
  const result = await chatJson(env, CAPTION_STRUCTURE_PROMPT, `Caption: "${caption}"`);
  return result as { topic: string; summary: string; tags: string[]; domain: string };
}
