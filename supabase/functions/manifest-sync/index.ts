import { createClient } from "@supabase/supabase-js";
import { createManifestSyncHandler } from "./handler.js";

Deno.serve(createManifestSyncHandler({
  getEnv: (name) => Deno.env.get(name),
  createClient,
}));
