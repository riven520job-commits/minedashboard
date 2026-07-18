import assert from "node:assert/strict";
import test from "node:test";
import { createJapaneseAiHandler, languageInstruction, lookupJisho } from "../supabase/functions/japanese-ai/handler.js";

const request = (value, method = "POST") => new Request("http://localhost/japanese-ai", {
  method,
  body: value === undefined ? undefined : JSON.stringify(value),
  headers: { "Content-Type": "application/json" },
});
const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
  status: init.status || 200,
  headers: { "Content-Type": "application/json" },
});

test("Japanese AI handles CORS, methods, malformed JSON, and missing words", async () => {
  const handler = createJapaneseAiHandler({ getEnv: () => "key", fetch: () => assert.fail() });
  assert.equal((await handler(request(undefined, "OPTIONS"))).headers.get("access-control-allow-origin"), "*");
  assert.equal((await handler(request(undefined, "GET"))).status, 405);
  assert.equal((await handler(new Request("http://localhost", { method: "POST", body: "{" }))).status, 500);
  assert.equal((await handler(request({ word: "  " }))).status, 400);
});

test("lookup-only flow queries Jisho and skips Gemini", async () => {
  const calls = [];
  const dictionary = { slug: "猫", japanese: [{ reading: "ねこ" }] };
  const handler = createJapaneseAiHandler({
    getEnv: () => undefined,
    fetch: async (url, init) => {
      calls.push([url, init]);
      return jsonResponse({ data: [dictionary] });
    },
  });
  const response = await handler(request({ word: " 猫 ", lookupOnly: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { dictionary });
  assert.match(calls[0][0], /keyword=%E7%8C%AB$/);
  assert.equal(calls.length, 1);
});

test("provided dictionary skips Jisho and missing Gemini key is reported", async () => {
  const handler = createJapaneseAiHandler({ getEnv: () => undefined, fetch: () => assert.fail() });
  const response = await handler(request({ word: "猫", dictionaryData: { slug: "猫" } }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Missing GEMINI_API_KEY secret" });
});

test("AI flow sends a localized prompt and parses JSON output", async () => {
  const calls = [];
  const dictionary = { slug: "猫" };
  const result = { summary: "cat" };
  const handler = createJapaneseAiHandler({
    getEnv: (name) => name === "GEMINI_API_KEY" ? "gemini-key" : undefined,
    fetch: async (url, init) => {
      calls.push([url, init]);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
    },
  });
  const response = await handler(request({ word: "猫", dictionaryData: dictionary, uiLanguage: "en" }));
  assert.deepEqual(await response.json(), { result, dictionary });
  const [url, init] = calls[0];
  assert.match(url, /gemini-3\.5-flash:generateContent$/);
  assert.equal(init.headers["x-goog-api-key"], "gemini-key");
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  assert.match(prompt, /learner-friendly English/);
  assert.match(prompt, /Japanese lookup target:\n猫/);
});

test("AI flow preserves non-JSON model text", async () => {
  const handler = createJapaneseAiHandler({
    getEnv: () => "key",
    fetch: async () => jsonResponse({ candidates: [{ content: { parts: [{ text: "plain " }, { text: "answer" }] } }] }),
  });
  const response = await handler(request({ word: "猫", dictionaryData: {} }));
  assert.deepEqual(await response.json(), { result: "plain answer", dictionary: {} });
});

test("AI flow propagates Gemini errors and catches fetch failures", async () => {
  const rejected = createJapaneseAiHandler({
    getEnv: () => "key",
    fetch: async () => jsonResponse({ error: { message: "quota exceeded" } }, { status: 429 }),
  });
  const response = await rejected(request({ word: "猫", dictionaryData: {} }));
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "quota exceeded" });

  const crashed = createJapaneseAiHandler({ getEnv: () => "key", fetch: async () => { throw new Error("offline"); } });
  assert.deepEqual(await (await crashed(request({ word: "猫", dictionaryData: {} }))).json(), { error: "offline" });
});

test("Jisho failures become an empty dictionary and language instructions cover defaults", async () => {
  assert.equal(await lookupJisho("猫", async () => new Response("no", { status: 503 })), null);
  assert.equal(await lookupJisho("猫", async () => { throw new Error("offline"); }), null);
  assert.match(languageInstruction("ja"), /日本語/);
  assert.match(languageInstruction("en"), /English/);
  assert.match(languageInstruction("unsupported"), /繁體中文/);
});
