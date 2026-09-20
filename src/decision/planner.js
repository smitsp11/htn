import { readFile } from 'node:fs/promises';
import { availableContract, validatePlan, validateSchema } from './data.js';

export async function generatePlan(schema, appetite, { apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-4.1-mini', fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error('Set OPENAI_API_KEY in .env.');
  validateSchema(schema);
  const contract = availableContract(schema);
  const instructions = await readFile(new URL('../../prompts/query-planner.md', import.meta.url), 'utf8');
  const outputSchema = {
    type: 'object', additionalProperties: false, required: ['summary', 'queries'],
    properties: {
      summary: { type: 'string' },
      queries: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['resource', 'select', 'purpose'], properties: {
          resource: { type: 'string', enum: Object.keys(contract) },
          select: { type: 'array', items: { type: 'string' } },
          purpose: { type: 'string' },
        } } },
    },
  };
  let correction;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, store: false, instructions,
        input: JSON.stringify({ objective: 'Rank every submission against the 2025 commercial property appetite.', schema, appetite, minimumDataContract: contract, correction }),
        max_output_tokens: 5000,
        text: { format: { type: 'json_schema', name: 'underwriting_query_plan', strict: true, schema: outputSchema } },
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const code = String(error?.error?.code ?? '').replace(/[^a-z0-9_]/gi, '').slice(0,60);
      throw new Error(`OpenAI query planning failed (HTTP ${response.status}${code ? `, ${code}` : ''}).`);
    }
    const result = await response.json();
    if (result.status !== 'completed') throw new Error('OpenAI query plan was incomplete; no queries executed.');
    const content = (result.output ?? []).flatMap(o => o.content ?? []);
    if (content.some(c => c.type === 'refusal')) throw new Error('OpenAI declined the query planning request.');
    try {
      const plan = JSON.parse(content.filter(c => c.type === 'output_text').map(c => c.text).join(''));
      validatePlan(plan, schema);
      return { ...plan, model: result.model ?? model, responseId: result.id, usage: result.usage, attempts: attempt + 1 };
    } catch (error) {
      if (attempt === 1) throw new Error('OpenAI returned an invalid query plan after one repair; no queries executed.');
      correction = error instanceof SyntaxError ? 'Return valid JSON matching the requested schema.' : error.message;
    }
  }
}
