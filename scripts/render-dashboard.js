import { readFile, readdir, writeFile } from 'node:fs/promises';
import { htmlReport } from '../src/decision/report.js';

try {
  let reportPath = process.argv[2];
  if (!reportPath) {
    const folders = (await readdir('artifacts/decision', { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
    for (const folder of folders) {
      const candidate = `artifacts/decision/${folder}/report.json`;
      try { await readFile(candidate, 'utf8'); reportPath = candidate; break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  if (!reportPath) throw new Error('No completed report found. Run npm run agent:rank first.');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  await writeFile('artifacts/dashboard.html', htmlReport(report));
  await writeFile('artifacts/dashboard-report.json', JSON.stringify(report));
  console.log(`Dashboard updated: artifacts/dashboard.html (${report.rows.length} submissions, data from ${report.fetchedAt ?? report.generatedAt}).`);
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'No saved report found. Run npm run agent:rank first.' : error.message);
  process.exitCode = 1;
}
