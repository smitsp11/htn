import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { FederatoClient } from '../src/federato.js';

async function save(name, data) {
  await mkdir('artifacts/federato', { recursive: true });
  const path = `artifacts/federato/${name}.json`;
  await writeFile(path, JSON.stringify(data, null, 2));
  console.log(`Saved ${path}`);
}

try {
  const command = process.argv[2];
  if (!['check', 'schema', 'query'].includes(command)) {
    throw new Error('Usage: federato.js check | schema | query <query.json>');
  }
  const client = new FederatoClient();
  if (command === 'check' || command === 'schema') {
    const schema = await client.schema();
    await save('schema', schema);
    console.log('Authentication and schema retrieval succeeded.');
  }
  if (command === 'check') {
    const result = await client.query({ resource: 'Policy', pagination: { limit: 5 } });
    await save('policy-sample', result);
    console.log('Policy sample query succeeded (requested up to 5 records).');
  }
  if (command === 'query') {
    if (!process.argv[3]) throw new Error('Provide a JSON query file.');
    const payload = JSON.parse(await readFile(process.argv[3], 'utf8'));
    await save(`query-${Date.now()}`, await client.query(payload));
  }
} catch (error) {
  // Only print our own messages; remote errors can contain sensitive data.
  const safe = /^(Federato |Set FEDERATO_|Usage: |Provide a JSON)/.test(error.message);
  console.error(safe ? error.message : `Federato operation failed (${error.name}). Check network access and JSON input.`);
  process.exitCode = 1;
}
