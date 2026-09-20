import { readFile, readdir } from 'node:fs/promises';
import { caseSignals } from '../src/decision/casefile.js';

const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const pct = value => value == null ? '—' : `${Math.round(value * 100)}%`;
const rule = label => `\n${label}\n${'─'.repeat(Math.max(label.length, 58))}`;

async function latestReport() {
  const folders = (await readdir('artifacts/decision', { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse();
  for (const folder of folders) {
    try { return JSON.parse(await readFile(`artifacts/decision/${folder}/report.json`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('No completed report found. Run npm run agent:rank first.');
}

try {
  const query = process.argv[2];
  if (!query) throw new Error('Usage: npm run case -- SUB-2025-00001');
  const report = await latestReport();
  const needle = query.toLowerCase();
  const row = report.rows.find(r => String(r.submissionNumber).toLowerCase() === needle)
    ?? report.rows.find(r => String(r.submissionNumber).toLowerCase().includes(needle))
    ?? report.rows.find(r => String(r.accountName).toLowerCase().includes(needle));
  if (!row) throw new Error(`No submission matched "${query}".`);
  const file = row.casefile;

  console.log(rule(`${row.submissionNumber} · ${row.accountName}`));
  console.log(`${row.lineOfBusiness ?? 'unknown line'} · ${row.primaryState ?? 'state unverified'} · effective ${row.effectiveDate ?? 'unknown'}`);
  console.log(`${row.score}/100 · ${row.verdict}${row.reviewPriority ? ` · review priority ${row.reviewPriority}` : ''}`);
  console.log(`Premium ${money(row.premium)} · TIV ${money(row.tiv)} · requested limit ${money(row.requestedLimit)}`);
  console.log(`\n${row.explanation} ${row.recommendation}`);

  const signals = caseSignals(row, report.rules);
  if (signals.length) {
    console.log(rule('WHAT STANDS OUT'));
    for (const signal of signals) console.log(`[${signal.tone}] ${signal.headline}\n    ${signal.detail}`);
  }

  if ((row.tasks ?? []).length) {
    console.log(rule('WHAT TO ASK FOR'));
    for (const task of row.tasks) {
      console.log(`[${task.severity}] ${task.question}`);
      console.log(`    ask: ${task.askOf.join(', ') || 'unassigned'}${task.pointsAtStake ? ` · ${task.pointsAtStake} pts` : ''}`);
      for (const item of row.leads?.[task.factorKey] ?? []) {
        console.log(`    · ${item.label}: ${item.value}`);
        console.log(`      (${item.caution})`);
      }
    }
  }

  if (file?.relationship) {
    const rel = file.relationship;
    console.log(rule('RELATIONSHIP'));
    if (rel.isNewAccount) console.log('New account — no prior policies with us.');
    else {
      console.log(`${rel.inForceCount} polic${rel.inForceCount === 1 ? 'y' : 'ies'} in force · ${money(rel.inForcePremium)} premium · ${rel.tenureYears ?? '—'} yrs`);
      for (const line of rel.byLine) console.log(`    ${line.line.padEnd(10)} ${money(line.premium)}`);
      if (rel.lapsed.length) console.log(`  ! lapsed: ${rel.lapsed.map(p => `${p.line} (${p.status})`).join(', ')}`);
      if (rel.declinedSubmissions.length) console.log(`  ! previously turned away: ${rel.declinedSubmissions.map(s => `${s.number} ${s.line}/${s.status}`).join(', ')}`);
    }
  }

  if (file?.lossExperience?.claimCount) {
    const loss = file.lossExperience;
    console.log(rule('LOSS EXPERIENCE (ALL LINES)'));
    console.log(`${loss.claimCount} claims · ${money(loss.totalIncurred)} incurred · ${loss.openCount} open (${money(loss.openIncurred)})${loss.lossRatio != null ? ` · ${loss.lossRatio}% of premium` : ''}`);
    for (const claim of loss.claims.slice(0, 10)) {
      console.log(`    ${(claim.dateOfLoss ?? '—').padEnd(12)} ${String(claim.line).padEnd(9)} ${String(claim.cause ?? '—').padEnd(22)} ${claim.open ? claim.status.toUpperCase().padEnd(11) : 'closed'.padEnd(11)} ${money(claim.incurred)}`);
    }
  }
  if (row.loss?.gaps?.length) {
    console.log(`  ! no loss data for ${row.loss.gaps.map(g => `${g.start} → ${g.end}`).join(', ')}`);
  }

  if (file?.exposure?.siteCount) {
    const exposure = file.exposure;
    console.log(rule('EXPOSURE'));
    console.log(`${exposure.siteCount} sites · ${exposure.buildingCount} buildings · ${money(exposure.totalTiv)} TIV · largest site ${pct(exposure.concentration)}`);
    for (const site of exposure.sites.slice(0, 8)) {
      console.log(`    ${String(site.address ?? `Location ${site.id}`).slice(0, 30).padEnd(32)} ${String(site.state ?? '—').padEnd(3)} ${String(site.buildingCount).padStart(2)} bldg ${money(site.tiv).padStart(14)} ${pct(site.share).padStart(5)}`);
    }
    console.log(`  construction: ${exposure.constructionMix.map(m => `${m.type} ${pct(m.share)}`).join(', ')}`);
  }

  if (file?.comparables?.peerCount) {
    const peers = file.comparables;
    console.log(rule(`PEERS (NAICS ${peers.industryKey})`));
    console.log(`this ${peers.thisRate != null ? `$${peers.thisRate}` : '—'} per $1k TIV · peer median ${peers.medianRate != null ? `$${peers.medianRate}` : '—'}${peers.ratePosition != null ? ` (${peers.ratePosition > 0 ? '+' : ''}${peers.ratePosition}%)` : ''}`);
    for (const peer of peers.peers.slice(0, 6)) {
      console.log(`    ${peer.accountName.slice(0, 28).padEnd(30)} ${money(peer.premium).padStart(12)} ${String('$' + peer.rate).padStart(8)}/1k ${peer.lossRatio != null ? `${peer.lossRatio}% LR` : ''}`);
    }
  }

  if (file?.broker) {
    const broker = file.broker;
    console.log(rule('BROKER'));
    console.log(`${broker.name ?? `Broker ${broker.id}`}${broker.tier ? ` · Tier ${broker.tier}` : ''} · ${broker.submissionCount} submissions · ${broker.bound} bound / ${broker.lost} lost${broker.hitRate != null ? ` · ${broker.hitRate}% hit rate` : ''}`);
  }

  if (row.external?.evidence?.length) {
    console.log(rule('EXTERNAL EVIDENCE (UNREVIEWED)'));
    for (const record of row.external.evidence) {
      console.log(`    ${record.provider}: ${Object.entries(record.fields ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    for (const conflict of row.external.conflicts ?? []) {
      console.log(`  ! ${conflict.provider} says ${conflict.field}=${conflict.external}, Federato holds ${conflict.federato.join(', ')}`);
    }
  }
  console.log('');
} catch (error) {
  const safe = /^(Usage:|No submission matched|No completed report)/.test(String(error.message));
  console.error(safe ? error.message : `Could not open the case (${error.name}).`);
  process.exitCode = 1;
}
