export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function languageInstruction(uiLanguage) {
  if (uiLanguage === "ja") return "日本語で、やさしく簡潔に説明してください。";
  if (uiLanguage === "en") return "Explain in concise, learner-friendly English.";
  return "請使用繁體中文，以日語學習者容易理解的方式說明。";
}

export async function lookupJisho(word, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "manifest-dictionary/1.0",
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

export function createJapaneseAiHandler({ getEnv, fetch: fetchImpl }) {
  return async function japaneseAiHandler(req) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
    }

    try {
      const { word, dictionaryData, uiLanguage = "zh", lookupOnly = false } = await req.json();
      const trimmedWord = String(word || "").trim();
      if (!trimmedWord) {
        return Response.json({ error: "Missing word" }, { status: 400, headers: corsHeaders });
      }

      const dictionary = dictionaryData ?? await lookupJisho(trimmedWord, fetchImpl);
      if (lookupOnly) return Response.json({ dictionary }, { headers: corsHeaders });

      const apiKey = getEnv("GEMINI_API_KEY");
      if (!apiKey) {
        return Response.json({ error: "Missing GEMINI_API_KEY secret" }, { status: 500, headers: corsHeaders });
      }

      const prompt = `
You are a careful Japanese teacher.
${languageInstruction(uiLanguage)}

Japanese lookup target:
${trimmedWord}

Dictionary data, if available:
${JSON.stringify(dictionary ?? {}, null, 2)}

Return only valid JSON with this exact shape:
{
  "summary": "core meaning",
  "readingTip": "reading or pronunciation note",
  "grammar": "part of speech and usage",
  "examples": ["example 1", "example 2", "example 3"],
  "memoryHint": "memorable learning hook",
  "commonMistake": "common learner mistake"
}
`;

      const aiResponse = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
        }),
      });
      const aiJson = await aiResponse.json();

      if (!aiResponse.ok) {
        return Response.json(
          { error: aiJson?.error?.message || "Gemini request failed" },
          { status: aiResponse.status, headers: corsHeaders },
        );
      }

      const outputText = aiJson.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        ?.join("")
        ?.trim();
      let parsed = outputText;
      try {
        parsed = JSON.parse(outputText);
      } catch {
        // Keep plain text if the model returns non-JSON despite the instruction.
      }

      return Response.json({ result: parsed, dictionary }, { headers: corsHeaders });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500, headers: corsHeaders },
      );
    }
  };
}
