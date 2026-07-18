import assert from "node:assert/strict";
import test from "node:test";
import { createManifestSyncHandler, hashSyncId } from "../supabase/functions/manifest-sync/handler.js";

const fixedDate = new Date("2026-07-18T00:00:00.000Z");
const request = (body, method = "POST") => new Request("http://localhost/manifest-sync", {
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});
const body = (response) => response.json();

function setup({ upsertError = null, selected = null, selectError = null } = {}) {
  const calls = [];
  const query = {
    select(columns) { calls.push(["select", columns]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    async maybeSingle() { return { data: selected, error: selectError }; },
  };
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        async upsert(value, options) {
          calls.push(["upsert", value, options]);
          return { error: upsertError };
        },
        ...query,
      };
    },
  };
  const createCalls = [];
  const handler = createManifestSyncHandler({
    getEnv: (name) => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" })[name],
    createClient: (...args) => { createCalls.push(args); return client; },
    now: () => fixedDate,
  });
  return { handler, calls, createCalls };
}

test("manifest sync handles CORS preflight and rejects unsupported methods", async () => {
  const { handler } = setup();
  const preflight = await handler(request(undefined, "OPTIONS"));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  const response = await handler(request(undefined, "GET"));
  assert.equal(response.status, 405);
  assert.deepEqual(await body(response), { error: "Method not allowed" });
});

test("manifest sync validates environment, JSON, action, and sync code", async () => {
  const missingEnv = createManifestSyncHandler({ getEnv: () => undefined, createClient: () => assert.fail() });
  assert.equal((await missingEnv(request({ action: "upload", syncId: "12345678" }))).status, 500);

  const { handler } = setup();
  const invalidJson = await handler(new Request("http://localhost", { method: "POST", body: "{" }));
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await body(invalidJson), { error: "Invalid JSON body" });
  assert.equal((await handler(request({ action: "erase", syncId: "12345678" }))).status, 400);
  assert.equal((await handler(request({ action: "upload", syncId: "short" }))).status, 400);
});

test("upload hashes the sync code and upserts dashboard data", async () => {
  const { handler, calls, createCalls } = setup();
  const response = await handler(request({ action: "upload", syncId: "  shared-code  ", data: { goals: ["walk"] } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { ok: true, updated_at: fixedDate.toISOString() });
  assert.equal(createCalls[0][0], "https://example.supabase.co");
  assert.deepEqual(createCalls[0][2], { auth: { persistSession: false, autoRefreshToken: false } });
  const upsert = calls.find(([name]) => name === "upsert");
  assert.equal(upsert[1].sync_id, await hashSyncId("shared-code"));
  assert.deepEqual(upsert[1].data, { goals: ["walk"] });
  assert.equal(upsert[1].updated_at, fixedDate.toISOString());
  assert.deepEqual(upsert[2], { onConflict: "sync_id" });
});

test("upload uses empty data and returns database failures", async () => {
  const { handler, calls } = setup({ upsertError: { message: "write failed" } });
  const response = await handler(request({ action: "upload", syncId: "12345678" }));
  assert.equal(response.status, 500);
  assert.deepEqual(await body(response), { error: "write failed" });
  assert.deepEqual(calls.find(([name]) => name === "upsert")[1].data, {});
});

test("download returns the saved record or an empty result", async () => {
  const saved = { data: { journal: [1] }, updated_at: "2026-07-17T12:00:00Z" };
  const first = setup({ selected: saved });
  const response = await first.handler(request({ action: "download", syncId: "12345678" }));
  assert.deepEqual(await body(response), { ok: true, data: saved.data, updated_at: saved.updated_at });
  assert.deepEqual(first.calls.slice(-3).map(([name]) => name), ["from", "select", "eq"]);

  const empty = setup();
  assert.deepEqual(await body(await empty.handler(request({ action: "download", syncId: "12345678" }))), {
    ok: true, data: null, updated_at: null,
  });
});

test("download returns database failures", async () => {
  const { handler } = setup({ selectError: { message: "read failed" } });
  const response = await handler(request({ action: "download", syncId: "12345678" }));
  assert.equal(response.status, 500);
  assert.deepEqual(await body(response), { error: "read failed" });
});
