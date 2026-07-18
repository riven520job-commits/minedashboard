import "@supabase/functions-js/edge-runtime.d.ts";
import { createJapaneseAiHandler } from "./handler.js";

Deno.serve(createJapaneseAiHandler({
  getEnv: (name) => Deno.env.get(name),
  fetch,
}));
