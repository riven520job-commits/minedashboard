export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function hashSyncId(syncId) {
  const bytes = new TextEncoder().encode(syncId.trim());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `edge:${Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createManifestSyncHandler({ getEnv, createClient, now = () => new Date() }) {
  return async function manifestSyncHandler(req) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Missing Supabase service role environment" }, 500);
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const action = String(payload?.action || "");
    const syncId = String(payload?.syncId || "").trim();
    if (!["upload", "download"].includes(action)) return json({ error: "Invalid action" }, 400);
    if (syncId.length < 8) return json({ error: "Sync code must be at least 8 characters" }, 400);

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rowId = await hashSyncId(syncId);

    if (action === "upload") {
      const updatedAt = now().toISOString();
      const { error } = await client.from("manifestation_sync").upsert({
        sync_id: rowId,
        data: payload.data || {},
        updated_at: updatedAt,
      }, { onConflict: "sync_id" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, updated_at: updatedAt });
    }

    const { data, error } = await client
      .from("manifestation_sync")
      .select("data, updated_at")
      .eq("sync_id", rowId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, data: data?.data || null, updated_at: data?.updated_at || null });
  };
}
