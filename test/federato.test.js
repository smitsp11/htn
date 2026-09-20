import test from 'node:test';
import assert from 'node:assert/strict';
import { FederatoClient } from '../src/federato.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const credentials = { clientId: 'test-id', clientSecret: 'test-secret' };

test('authenticates on the custom domain, reuses tokens and unwraps workflow results', async () => {
  const calls = [];
  const client = new FederatoClient({ ...credentials, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/oauth/token')) return json({ access_token: 'test-token', expires_in: 14400 });
    return json({ output: [{ data: { results: [{ id: 1 }], total: 1 } }] });
  } });
  assert.deepEqual(await client.schema(), { results: [{ id: 1 }], total: 1 });
  await client.query({ resource: 'Policy', pagination: { limit: 5 } });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://auth.product.federato.ai/oauth/token');
  assert.deepEqual(JSON.parse(calls[0].body), {
    client_id: 'test-id', client_secret: 'test-secret',
    audience: 'https://product.federato.ai/core-api', grant_type: 'client_credentials',
  });
  assert.equal(calls[1].headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[2].body), { action: 'query', payload: { resource: 'Policy', pagination: { limit: 5 } } });
});

test('refreshes on 401 exactly once and surfaces persistent rejection', async () => {
  let authCalls = 0;
  let apiCalls = 0;
  const client = new FederatoClient({ ...credentials, fetchImpl: async url => {
    if (url.endsWith('/oauth/token')) {
      authCalls++;
      return json({ access_token: `token-${authCalls}`, expires_in: 14400 });
    }
    apiCalls++;
    return json({ error: 'rejected' }, 401);
  } });
  await assert.rejects(client.schema(), /HTTP 401/);
  assert.equal(authCalls, 2);
  assert.equal(apiCalls, 2);
});

test('refreshes a short-lived token before the next API call', async () => {
  let authCalls = 0;
  const client = new FederatoClient({ ...credentials, fetchImpl: async url => {
    if (url.endsWith('/oauth/token')) {
      authCalls++;
      return json({ access_token: 'token', expires_in: 30 });
    }
    return json({ Policy: {} });
  } });
  await client.schema();
  await client.schema();
  assert.equal(authCalls, 2);
});

test('rejects wrapped application errors without exposing remote messages', async () => {
  const client = new FederatoClient({ ...credentials, fetchImpl: async url =>
    url.endsWith('/oauth/token') ? json({ access_token: 'token', expires_in: 14400 })
      : json({ output: [{ data: { error: 'sensitive remote details' } }] }) });
  await assert.rejects(client.schema(), { message: 'Federato schema returned an application error.' });
});
