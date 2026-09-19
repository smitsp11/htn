export type RankingsErrorCategory = "auth" | "configuration" | "query" | "unknown";

export interface RankingsErrorBody {
  error: string;
  category: RankingsErrorCategory;
}

/**
 * Person 1's client throws plain Errors. Categorise by message so the UI can
 * show an authentication state, a configuration hint, or a query failure
 * without the route knowing about transport internals.
 */
export function categorizeError(error: unknown): RankingsErrorBody {
  if (!(error instanceof Error)) return { error: "Unknown ranking failure", category: "unknown" };
  const message = error.message;
  if (/authentication|access token|CLIENT_ID|CLIENT_SECRET/i.test(message)) return { error: message, category: "auth" };
  if (/FEDERATO_[A-Z_]+|not valid JSON/.test(message)) return { error: message, category: "configuration" };
  if (/API request failed|query/i.test(message)) return { error: message, category: "query" };
  return { error: message, category: "unknown" };
}

export function httpStatusFor(category: RankingsErrorCategory): number {
  switch (category) {
    case "auth":
      return 401;
    case "query":
      return 502;
    default:
      return 500;
  }
}
