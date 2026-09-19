/**
 * Transport-level helpers for the Federato client: a single bounded-timeout
 * `fetchJson` and a categorized error type. Categories let the shared UI tell
 * an authentication problem apart from a transport/rate failure, malformed
 * JSON, a timeout, or a pagination-completeness problem.
 *
 * SECURITY: error messages here are built only from the HTTP status and the
 * response body. They never include the access token, client id/secret, or the
 * Authorization header, so a thrown error is always safe to surface or log.
 */
export type FederatoErrorCategory =
  | "auth"
  | "transport"
  | "malformed"
  | "timeout"
  | "pagination";

export class FederatoTransportError extends Error {
  readonly category: FederatoErrorCategory;
  readonly status?: number;

  constructor(category: FederatoErrorCategory, message: string, status?: number) {
    super(message);
    this.name = "FederatoTransportError";
    this.category = category;
    this.status = status;
  }
}

export interface FetchJsonOptions {
  /** Abort the request after this many ms. */
  timeoutMs?: number;
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function readBodySnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * POST/GET JSON with a bounded timeout and categorized failures. Returns the
 * parsed JSON body on success. The message wording is deliberately chosen so
 * that the downstream rankings error categorizer maps auth/query/malformed
 * failures sensibly, while `error.category` carries the precise transport cause.
 */
export async function fetchJson(
  url: string,
  init: RequestInit,
  options: FetchJsonOptions = {},
): Promise<unknown> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FederatoTransportError("timeout", `Federato API request timed out after ${timeoutMs}ms.`);
    }
    // Network/DNS/connection failures. `error` here carries no credentials.
    const reason = error instanceof Error ? error.message : "unknown transport error";
    throw new FederatoTransportError("transport", `Federato API request failed to reach the server: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new FederatoTransportError(
      "auth",
      `Federato authentication failed (${response.status}). Check the Auth0 domain (auth.product.federato.ai), audience, and credentials.`,
      response.status,
    );
  }

  if (!response.ok) {
    const detail = await readBodySnippet(response);
    throw new FederatoTransportError(
      "transport",
      `Federato API request failed (${response.status})${detail ? `: ${detail}` : "."}`,
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new FederatoTransportError("malformed", "Federato query response was malformed JSON.");
  }
}
