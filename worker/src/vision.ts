import type { Env } from "./types";

/**
 * Reuses the same Workers AI binding already used for embeddings, rather than adding a
 * second external vision API/key - one less credential to manage. `llava-1.5-7b` is
 * Workers AI's general-purpose image-captioning/VQA model.
 */
const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

/** Produces a detailed text description of an uploaded image - this becomes the entry's
 * "summary" and is what gets embedded, so the more concrete detail it captures (objects,
 * people, text visible, setting), the better later retrieval works. */
export async function captionImage(env: Env, imageBytes: ArrayBuffer): Promise<string> {
  const result = (await env.AI.run(VISION_MODEL, {
    image: Array.from(new Uint8Array(imageBytes)),
    prompt:
      "Describe this image in concrete, specific detail: objects, people, any visible " +
      "text, setting, and anything that would help someone recall what this photo is of " +
      "later. Do not speculate beyond what is visible.",
    max_tokens: 512,
  })) as { description?: string; response?: string };

  const caption = result.description ?? result.response;
  if (!caption) {
    throw new Error("vision model returned no caption");
  }
  return caption.trim();
}
