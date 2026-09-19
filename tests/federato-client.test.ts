import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { FederatoClient } from "../lib/federato/client";
import { defaultExtractPage, fetchAllPages } from "../lib/federato/pagination";
import { getSourceStatus, resetStatus } from "../lib/federato/status";
import { FederatoTransportError } from "../lib/federato/transport";
import { TokenCache } from "../lib/federato/token-cache";
import {
  API_URL,
  AUTH_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  httpError,
  jsonOk,
  makeFetch,
  makeTimeoutFetch,
  malformedJson,
} from "./fixtures/federato/transport";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.FEDERATO_AUTH_URL = AUTH_URL;
  process.env.FEDERATO_API_URL = API_URL;
  process.env.FEDERATO_CLIENT_ID = CLIENT_ID;
  process.env.FEDERATO_CLIENT_SECRET = CLIENT_SECRET;
  process.env.FEDERATO_USE_DEMO_DATA = "false";
  delete process.env.FEDERATO_AUDIENCE;
  globalThis.fetch = realFetch;
  resetStatus();
});

/** A fresh token cache with a controllable clock for each test. */
function testCache(startMs = 0, earlyRefreshMs = 5 * 60_000) {
  const clock = { now: startMs };
  const cache = new TokenCache(() => clock.now, earlyRefreshMs);
  return { cache, clock };
}

function assertNoCredentialLeak(message: string) {
  assert.doesNotMatch(message, new RegExp(CLIENT_SECRET));
  assert.doesNotMatch(message, new RegExp(CLIENT_ID));
  assert.doesNotMatch(message, /Bearer /);
  assert.doesNotMatch(message, /access_token/);
}

test("token is reused: a second request does not re-authenticate", async () => {
  const { cache } = testCache();
  const fetchMock = makeFetch({
    auth: () => jsonOk({ access_token: "token-1", expires_in: 14_400 }),
    api: () => jsonOk({ resources: ["submission"] }),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await client.getSchema();
  await client.getSchema();

  assert.equal(fetchMock.authCount, 1, "auth should be requested only once");
  // Both API calls carried the same bearer token.
  const apiCalls = fetchMock.calls.filter((c) => c.url === API_URL);
  assert.equal(apiCalls.length, 2);
  for (const call of apiCalls) {
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer token-1");
  }
});

test("token expiry triggers renewal with the early-refresh window", async () => {
  const { cache, clock } = testCache(0, 5 * 60_000);
  let issued = 0;
  const fetchMock = makeFetch({
    auth: () => jsonOk({ access_token: `token-${++issued}`, expires_in: 14_400 }),
    api: () => jsonOk({ ok: true }),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await client.getSchema();
  assert.equal(fetchMock.authCount, 1);

  // Still inside the safe window -> reuse.
  clock.now = 14_400_000 - 5 * 60_000 - 1;
  await client.getSchema();
  assert.equal(fetchMock.authCount, 1, "token should still be reused just before the refresh window");

  // Cross into the early-refresh window -> renew.
  clock.now = 14_400_000 - 5 * 60_000 + 1;
  await client.getSchema();
  assert.equal(fetchMock.authCount, 2, "token should be renewed once inside the refresh window");

  const lastApi = fetchMock.calls.filter((c) => c.url === API_URL).at(-1);
  assert.equal((lastApi?.init.headers as Record<string, string>).authorization, "Bearer token-2");
});

test("failed authentication (401) is categorized as auth and leaks no credential", async () => {
  const { cache } = testCache();
  const fetchMock = makeFetch({
    auth: () => httpError(401, "invalid token"),
    api: () => jsonOk({}),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await assert.rejects(client.getSchema(), (error: unknown) => {
    assert.ok(error instanceof FederatoTransportError);
    assert.equal(error.category, "auth");
    assert.match(error.message, /authentication failed \(401\)/);
    assertNoCredentialLeak(error.message);
    return true;
  });

  // Status reflects the failure without exposing anything sensitive.
  const status = getSourceStatus();
  assert.equal(status.authenticated, false);
  assert.equal(status.lastErrorCategory, "auth");
});

test("missing credentials raise a safe, categorizable error", async () => {
  delete process.env.FEDERATO_CLIENT_SECRET;
  const { cache } = testCache();
  const fetchMock = makeFetch({ auth: () => jsonOk({}), api: () => jsonOk({}) });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await assert.rejects(client.getSchema(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /FEDERATO_CLIENT_SECRET is required/);
    return true;
  });
  assert.equal(fetchMock.authCount, 0, "no network call should be made without credentials");
});

test("successful schema request sends the right body and returns parsed JSON", async () => {
  const { cache } = testCache();
  const schema = { resources: [{ name: "submission", fields: ["id"] }] };
  const fetchMock = makeFetch({
    auth: () => jsonOk({ access_token: "t", expires_in: 14_400 }),
    api: () => jsonOk(schema),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  const result = await client.getSchema();
  assert.deepEqual(result, schema);

  const apiCall = fetchMock.calls.find((c) => c.url === API_URL);
  assert.deepEqual(apiCall?.body, { action: "schema" });

  const status = getSourceStatus();
  assert.equal(status.authenticated, true);
  assert.equal(status.schemaReachable, true);
  assert.ok(status.lastSuccessfulRequestAt);
});

test("query sends action+payload and includes the audience when configured", async () => {
  process.env.FEDERATO_AUDIENCE = "https://api.federato.ai";
  const { cache } = testCache();
  const fetchMock = makeFetch({
    auth: () => jsonOk({ access_token: "t", expires_in: 14_400 }),
    api: () => jsonOk({ data: [] }),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await client.query({ select: ["id"] });

  const authCall = fetchMock.calls.find((c) => c.url === AUTH_URL);
  assert.equal((authCall?.body as Record<string, unknown>).audience, "https://api.federato.ai");
  const apiCall = fetchMock.calls.find((c) => c.url === API_URL);
  assert.deepEqual(apiCall?.body, { action: "query", payload: { select: ["id"] } });
});

test("queryAll retrieves every page and proves completeness (does not stop at page one)", async () => {
  const { cache } = testCache();
  const pages: Record<string, unknown> = {
    __first__: { data: [{ id: 1 }, { id: 2 }], pagination: { nextCursor: "c1" } },
    c1: { data: [{ id: 3 }, { id: 4 }], pagination: { nextCursor: "c2" } },
    c2: { data: [{ id: 5 }], pagination: { nextCursor: null } },
  };
  const fetchMock = makeFetch({
    auth: () => jsonOk({ access_token: "t", expires_in: 14_400 }),
    api: (body) => {
      const payload = (body as { payload?: { cursor?: string } }).payload ?? {};
      const key = payload.cursor ?? "__first__";
      return jsonOk(pages[key]);
    },
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  const result = await client.queryAll({ select: ["id"] });
  assert.equal(result.pageCount, 3);
  assert.deepEqual(result.records.map((r) => (r as { id: number }).id), [1, 2, 3, 4, 5]);
  assert.equal(result.duplicatePagesDetected, false);

  const status = getSourceStatus();
  assert.equal(status.lastRecordCount, 5);
  assert.equal(status.lastPageCount, 3);
});

test("pagination terminates on a looping cursor instead of spinning forever", async () => {
  const { cache } = testCache();
  const fetchMock = makeFetch({
    auth: () => jsonOk({ access_token: "t", expires_in: 14_400 }),
    // Always advertises the same next cursor -> a loop.
    api: () => jsonOk({ data: [{ id: 1 }], pagination: { nextCursor: "loop" } }),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await assert.rejects(client.queryAll({ select: ["id"] }), (error: unknown) => {
    assert.ok(error instanceof FederatoTransportError);
    assert.equal(error.category, "pagination");
    assert.match(error.message, /already used/);
    return true;
  });
});

test("pagination detects duplicate pages via dedupeKey and still terminates", async () => {
  const seq = [
    { data: [{ id: "a" }, { id: "b" }], pagination: { nextCursor: "p2" } },
    // p2 accidentally repeats the same records, then ends.
    { data: [{ id: "a" }, { id: "b" }], pagination: { nextCursor: null } },
  ];
  let i = 0;
  const result = await fetchAllPages<{ id: string }>({
    fetchPage: async () => seq[Math.min(i++, seq.length - 1)],
    extract: (raw) => defaultExtractPage(raw) as { records: { id: string }[]; nextCursor: string | null },
    dedupeKey: (record) => record.id,
  });

  assert.equal(result.pageCount, 2);
  assert.equal(result.duplicatePagesDetected, true);
  assert.deepEqual(result.records.map((r) => r.id), ["a", "b"]);
});

test("pagination aborts past the maxPages ceiling", async () => {
  await assert.rejects(
    fetchAllPages({
      fetchPage: async () => ({ data: [{ id: 1 }], pagination: { nextCursor: String(Math.random()) } }),
      maxPages: 5,
    }),
    (error: unknown) => {
      assert.ok(error instanceof FederatoTransportError);
      assert.equal(error.category, "pagination");
      assert.match(error.message, /within 5 pages/);
      return true;
    },
  );
});

test("a request that exceeds the timeout raises a timeout error", async () => {
  const { cache } = testCache();
  const client = new FederatoClient({
    fetchImpl: makeTimeoutFetch(),
    tokenCache: cache,
    timeoutMs: 20,
  });

  await assert.rejects(client.getSchema(), (error: unknown) => {
    assert.ok(error instanceof FederatoTransportError);
    assert.equal(error.category, "timeout");
    assert.match(error.message, /timed out/);
    assertNoCredentialLeak(error.message);
    return true;
  });
});

test("malformed JSON in the API response is categorized as malformed", async () => {
  const { cache } = testCache();
  const fetchMock = makeFetch({
    auth: () => jsonOk({ access_token: "t", expires_in: 14_400 }),
    api: () => malformedJson(),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await assert.rejects(client.getSchema(), (error: unknown) => {
    assert.ok(error instanceof FederatoTransportError);
    assert.equal(error.category, "malformed");
    assert.match(error.message, /malformed JSON/);
    return true;
  });
});

test("authentication returning no access token fails safely", async () => {
  const { cache } = testCache();
  const fetchMock = makeFetch({
    auth: () => jsonOk({ expires_in: 14_400 }),
    api: () => jsonOk({}),
  });
  const client = new FederatoClient({ fetchImpl: fetchMock.impl, tokenCache: cache });

  await assert.rejects(client.getSchema(), (error: unknown) => {
    assert.ok(error instanceof FederatoTransportError);
    assert.equal(error.category, "auth");
    assert.match(error.message, /no access token/);
    assertNoCredentialLeak(error.message);
    return true;
  });
});

test("getSourceStatus exposes safe fields only and reflects demo mode", () => {
  process.env.FEDERATO_USE_DEMO_DATA = "true";
  const status = getSourceStatus();
  assert.equal(status.demoMode, true);
  assert.equal(status.configured, true);
  // No secret-bearing keys anywhere in the serialized status.
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /secret/i);
  assert.doesNotMatch(serialized, new RegExp(CLIENT_SECRET));
  assert.doesNotMatch(serialized, /access_token/);
});

test("configured is false in live mode without credentials", () => {
  delete process.env.FEDERATO_CLIENT_ID;
  delete process.env.FEDERATO_CLIENT_SECRET;
  const status = getSourceStatus();
  assert.equal(status.demoMode, false);
  assert.equal(status.configured, false);
});
