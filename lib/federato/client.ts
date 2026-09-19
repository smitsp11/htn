import {
  Cursor,
  PageShape,
  PaginationResult,
  defaultExtractPage,
  defaultWithCursor,
  fetchAllPages,
} from "./pagination";
import {
  recordAuthSuccess,
  recordFailure,
  recordRequestSuccess,
  recordSchemaReachable,
} from "./status";
import { FederatoTransportError, fetchJson } from "./transport";
import { TokenCache } from "./token-cache";

const DEFAULT_API_URL = "https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true";
const DEFAULT_AUTH_URL = "https://auth.product.federato.ai/oauth/token";
const DEFAULT_TIMEOUT_MS = 15_000;
/** Fallback token lifetime if the OAuth response omits expires_in (docs: ~4h). */
const FALLBACK_TOKEN_TTL_SECONDS = 14_400;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * Shared across every `new FederatoClient()` in the process so the pipeline,
 * which constructs a client per request, reuses one cached token.
 */
const sharedTokenCache = new TokenCache();

function required(name: "FEDERATO_CLIENT_ID" | "FEDERATO_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when demo mode is disabled.`);
  return value;
}

export interface FederatoClientDeps {
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable token cache for deterministic reuse/expiry tests. */
  tokenCache?: TokenCache;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

/** Options for retrieving every query page through the pagination helper. */
export interface QueryAllOptions {
  /** Override extraction for the real (currently ASSUMED) pagination shape. */
  extract?: (raw: unknown) => PageShape<unknown>;
  /** Override how a cursor is injected into the opaque query payload. */
  withCursor?: (payload: unknown, cursor: Cursor) => unknown;
  /** Safety ceiling on page count. */
  maxPages?: number;
  /** Stable record identity to detect duplicate pages. */
  dedupeKey?: (record: unknown) => string;
}

export class FederatoClient {
  private readonly apiUrl = process.env.FEDERATO_API_URL ?? DEFAULT_API_URL;
  private readonly authUrl = process.env.FEDERATO_AUTH_URL ?? DEFAULT_AUTH_URL;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenCache: TokenCache;
  private readonly timeoutMs: number;

  constructor(deps: FederatoClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.tokenCache = deps.tokenCache ?? sharedTokenCache;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Discover the schema. Signature is a frozen integration contract. */
  async getSchema(): Promise<unknown> {
    const result = await this.post({ action: "schema" });
    recordSchemaReachable(true);
    return result;
  }

  /** Run one query page with an opaque payload. Frozen integration contract. */
  async query(payload: unknown): Promise<unknown> {
    return this.post({ action: "query", payload });
  }

  /**
   * Retrieve EVERY query page and prove completeness. Does not assume the first
   * page holds the full queue; follows the cursor until exhausted with loop and
   * duplicate-page protection. The pagination shape is ASSUMED (see
   * ./pagination.ts) and fully overridable via `options`.
   */
  async queryAll(basePayload: unknown, options: QueryAllOptions = {}): Promise<PaginationResult<unknown>> {
    const withCursor = options.withCursor ?? defaultWithCursor;
    const result = await fetchAllPages<unknown>({
      fetchPage: (cursor) => this.query(withCursor(basePayload, cursor)),
      extract: options.extract ?? defaultExtractPage,
      maxPages: options.maxPages,
      dedupeKey: options.dedupeKey,
    });
    recordRequestSuccess({ records: result.records.length, pages: result.pageCount });
    return result;
  }

  private async getAccessToken(): Promise<string> {
    const cached = this.tokenCache.get();
    if (cached) return cached;

    const body: Record<string, string> = {
      grant_type: "client_credentials",
      client_id: required("FEDERATO_CLIENT_ID"),
      client_secret: required("FEDERATO_CLIENT_SECRET"),
    };
    if (process.env.FEDERATO_AUDIENCE) body.audience = process.env.FEDERATO_AUDIENCE;

    let token: TokenResponse;
    try {
      token = (await fetchJson(
        this.authUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        },
        { timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl },
      )) as TokenResponse;
    } catch (error) {
      recordFailure(categoryOf(error));
      throw error;
    }

    if (!token || typeof token.access_token !== "string" || token.access_token.length === 0) {
      recordFailure("auth");
      throw new FederatoTransportError("auth", "Federato authentication returned no access token.");
    }

    this.tokenCache.set(token.access_token, token.expires_in ?? FALLBACK_TOKEN_TTL_SECONDS);
    recordAuthSuccess();
    return token.access_token;
  }

  private async post(body: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    try {
      const result = await fetchJson(
        this.apiUrl,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        },
        { timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl },
      );
      recordRequestSuccess();
      return result;
    } catch (error) {
      recordFailure(categoryOf(error));
      throw error;
    }
  }
}

function categoryOf(error: unknown): FederatoTransportError["category"] {
  return error instanceof FederatoTransportError ? error.category : "transport";
}
