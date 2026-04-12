/**
 * Thin client wrappers that proxy Gemini requests through the backend,
 * keeping the GEMINI_API_KEY server-side only.
 */

export const callGeminiText = async (
  prompt: string,
  model = "gemini-2.5-flash-preview",
  jsonMode = false
): Promise<string> => {
  const res = await fetch("/api/gemini/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, jsonMode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Gemini API error ${res.status}`);
  }
  const data = await res.json() as { text: string };
  return data.text;
};

export const callGeminiVision = async (
  prompt: string,
  base64Data: string,
  mimeType: string,
  model = "gemini-2.0-flash"
): Promise<string> => {
  const res = await fetch("/api/gemini/vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, base64Data, mimeType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Gemini vision error ${res.status}`);
  }
  const data = await res.json() as { text: string };
  return data.text;
};
