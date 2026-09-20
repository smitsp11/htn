const TOKEN_URL = 'https://auth.product.federato.ai/oauth/token';
const AUDIENCE = 'https://product.federato.ai/core-api';
const API_URL = 'https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true';

export class FederatoClient {
  #token;
  #expiresAt = 0;

  constructor({ clientId = process.env.FEDERATO_CLIENT_ID, clientSecret = process.env.FEDERATO_CLIENT_SECRET, fetchImpl = globalThis.fetch } = {}) {
    if (!clientId || !clientSecret) throw new Error('Set FEDERATO_CLIENT_ID and FEDERATO_CLIENT_SECRET in .env.');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
  }

  async #accessToken() {
    if (this.#token && Date.now() < this.#expiresAt) return this.#token;
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, audience: AUDIENCE, grant_type: 'client_credentials' }),
    });
    if (!response.ok) throw new Error(`Federato authentication failed (HTTP ${response.status}).`);
    const result = await response.json();
    if (!result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
      throw new Error('Federato authentication returned an invalid token response.');
    }
    this.#token = result.access_token;
    this.#expiresAt = Date.now() + Math.max(0, result.expires_in - 60) * 1000;
    return this.#token;
  }

  async #request(action, payload) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#accessToken();
      const response = await this.fetch(API_URL, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(payload === undefined ? {} : { payload }) }),
      });
      if (response.status === 401 && attempt === 0) {
        this.#token = undefined;
        continue;
      }
      if (!response.ok) throw new Error(`Federato ${action} failed (HTTP ${response.status}).`);
      const raw = await response.json();
      const result = Array.isArray(raw?.output) && raw.output.length === 1 && Object.hasOwn(raw.output[0] ?? {}, 'data')
        ? raw.output[0].data : raw;
      if (result?.error || result?.errors || result?.success === false) {
        throw new Error(`Federato ${action} returned an application error.`);
      }
      return result;
    }
  }

  schema() { return this.#request('schema'); }

  query(payload) {
    if (!payload || typeof payload.resource !== 'string' || !payload.resource.trim()) {
      throw new Error('Federato query requires a resource name.');
    }
    return this.#request('query', payload);
  }
}
