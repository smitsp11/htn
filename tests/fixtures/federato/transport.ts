/**
 * Test fixtures for Person 1's Federato transport. Minimal fetch/Response fakes
 * so the client's auth caching, pagination, timeout, and error handling can be
 * exercised deterministically without real network access.
 *
 * Filenamed `transport.ts` under tests/fixtures/federato/ to avoid colliding
 * with other engineers' fixture files.
 */

/** Fixed URLs the tests point the client at (also set on process.env). */
export const AUTH_URL = "https://auth.product.federato.ai/oauth/token";
export const API_URL = "https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true";

/** Sentinel credentials — assert these never leak into any error message. */
export const CLIENT_ID = "CLIENT_ID_SENTINEL";
export const CLIENT_SECRET = "CLIENT_SECRET_SENTINEL";

export interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export function jsonOk(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

export function httpError(status: number, body = ""): FakeResponse {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  };
}

/** A 200 response whose body is not parseable as JSON. */
export function malformedJson(): FakeResponse {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
    text: async () => "<<not json>>",
  };
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

export interface MockFetch {
  impl: typeof fetch;
  calls: RecordedCall[];
  authCount: number;
}

/**
 * Build a mock fetch. `authResponder` handles the OAuth URL; `apiResponder`
 * handles the API URL and receives the parsed request body (and call index).
 */
export function makeFetch(handlers: {
  auth: () => FakeResponse | Promise<FakeResponse>;
  api: (body: unknown, apiCallIndex: number) => FakeResponse | Promise<FakeResponse>;
}): MockFetch {
  const state: MockFetch = { impl: undefined as unknown as typeof fetch, calls: [], authCount: 0 };
  let apiCallIndex = 0;

  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    let parsedBody: unknown;
    try {
      parsedBody = init.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      parsedBody = init.body;
    }
    state.calls.push({ url: href, init, body: parsedBody });

    if (href === AUTH_URL) {
      state.authCount += 1;
      return handlers.auth();
    }
    return handlers.api(parsedBody, apiCallIndex++);
  }) as unknown as typeof fetch;

  state.impl = impl;
  return state;
}

/** A fetch that never resolves the API call until its AbortSignal fires. */
export function makeTimeoutFetch(authResponse: FakeResponse = jsonOk({ access_token: "t", expires_in: 14_400 })): typeof fetch {
  return (async (url: string | URL, init: RequestInit = {}) => {
    if (String(url) === AUTH_URL) return authResponse;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
    });
  }) as unknown as typeof fetch;
}
