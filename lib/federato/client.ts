const DEFAULT_API_URL = "https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true";
const DEFAULT_AUTH_URL = "https://auth.product.federato.ai/oauth/token";

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | undefined;

function required(name: "FEDERATO_CLIENT_ID" | "FEDERATO_CLIENT_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when demo mode is disabled.`);
  return value;
}

export class FederatoClient {
  private readonly apiUrl = process.env.FEDERATO_API_URL ?? DEFAULT_API_URL;
  private readonly authUrl = process.env.FEDERATO_AUTH_URL ?? DEFAULT_AUTH_URL;

  async getSchema(): Promise<unknown> {
    return this.post({ action: "schema" });
  }

  async query(payload: unknown): Promise<unknown> {
    return this.post({ action: "query", payload });
  }

  private async getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

    const body: Record<string, string> = {
      grant_type: "client_credentials",
      client_id: required("FEDERATO_CLIENT_ID"),
      client_secret: required("FEDERATO_CLIENT_SECRET"),
    };
    if (process.env.FEDERATO_AUDIENCE) body.audience = process.env.FEDERATO_AUDIENCE;

    const response = await fetch(this.authUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Federato authentication failed (${response.status}). Check the Auth0 domain, audience, and credentials.`);

    const token = await response.json() as TokenResponse;
    if (!token.access_token) throw new Error("Federato authentication returned no access token.");
    cachedToken = {
      value: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 14_400) * 1_000,
    };
    return token.access_token;
  }

  private async post(body: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Federato API request failed (${response.status}): ${detail}`);
    }
    return response.json();
  }
}
