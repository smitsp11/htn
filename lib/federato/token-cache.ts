/**
 * Small, unit-testable cache for the Federato client-credentials access token.
 *
 * The organizer docs say tokens last roughly four hours. We refresh a little
 * before expiry (an "early refresh" safety window) so an in-flight request never
 * races the token's real expiry. The clock is injectable so tests can drive
 * reuse and renewal deterministically without waiting on real time.
 *
 * Only the opaque token string is stored. Nothing here logs or exposes it.
 */
export interface TokenCacheEntry {
  value: string;
  /** Absolute expiry in ms (clock-relative), already reduced by nothing here. */
  expiresAt: number;
}

const DEFAULT_EARLY_REFRESH_MS = 5 * 60_000; // refresh 5 minutes before real expiry

export class TokenCache {
  private entry: TokenCacheEntry | undefined;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly earlyRefreshMs: number = DEFAULT_EARLY_REFRESH_MS,
  ) {}

  /** Returns a still-valid cached token, or undefined if a refresh is due. */
  get(): string | undefined {
    if (this.entry && this.entry.expiresAt > this.now() + this.earlyRefreshMs) {
      return this.entry.value;
    }
    return undefined;
  }

  /** Store a freshly minted token using the OAuth `expires_in` (seconds). */
  set(value: string, expiresInSeconds: number): void {
    this.entry = { value, expiresAt: this.now() + expiresInSeconds * 1_000 };
  }

  /** Forget any cached token (forces the next request to re-authenticate). */
  reset(): void {
    this.entry = undefined;
  }

  /** Diagnostics helper: is a non-expired token currently cached? Never leaks it. */
  hasValidToken(): boolean {
    return this.get() !== undefined;
  }
}
