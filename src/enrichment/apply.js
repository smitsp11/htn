import { CONFIDENCE } from '../decision/evidence.js';

// Administrative suffixes differ between sources ("Miami-Dade" vs "Miami-Dade County").
// Comparing raw strings would report a conflict where the sources actually agree.
const COMPARATORS = {
  county: value => String(value).toLowerCase().replace(/\s+(county|parish|borough|municipality)$/, '').trim(),
};
const sameValue = (field, a, b) =>
  (COMPARATORS[field] ?? (v => String(v).trim().toLowerCase()))(a) ===
  (COMPARATORS[field] ?? (v => String(v).trim().toLowerCase()))(b);

const FEDERATO_EQUIVALENT = {
  yearBuilt: (row, siteId) => row.buildings.filter(b => String(b.locationId) === String(siteId)).map(b => b.yearBuilt),
  squareFootage: (row, siteId) => row.buildings.filter(b => String(b.locationId) === String(siteId)).map(b => b.squareFootage),
  county: (row, siteId) => [row.sites.find(s => String(s.id) === String(siteId))?.county],
};

/**
 * Attaches external evidence to scored rows as advisory context only.
 *
 * External data never changes a score. It can do exactly three things: propose a value for a
 * field Federato left blank, contradict a value Federato supplied, or raise a risk flag the
 * appetite guideline does not cover. All three become underwriter tasks.
 */
export function applyEnrichment(rows, enrichment, config) {
  if (!enrichment) return rows;
  const bySite = new Map(enrichment.sites.map(site => [String(site.siteId), site]));
  return rows.map(row => {
    const sites = (row.sites ?? []).map(site => bySite.get(String(site.id))).filter(Boolean);
    if (!sites.length) return row;

    const evidence = [];
    const proposals = [];
    const conflicts = [];
    const flags = [];

    for (const site of sites) {
      for (const record of site.evidence) {
        if (record.status !== 'ok') continue;
        evidence.push({ siteId: site.siteId, ...record });
        const provider = config.providers[record.provider];
        for (const [field, value] of Object.entries(record.fields ?? {})) {
          // Keying fields exist to reach the next provider; they are not underwriting facts.
          if (provider?.extract?.[field]?.role === 'keying') continue;
          // Only a field with a Federato counterpart can fill a gap or contradict a record.
          // Everything else — flood zone, forecast office, alert count — is context: recorded
          // as evidence and flagged when it is hazardous, never queued as "accept this?".
          if (!FEDERATO_EQUIVALENT[field]) continue;
          const existing = FEDERATO_EQUIVALENT[field](row, site.siteId)?.filter(v => v != null) ?? [];
          if (!existing.length) {
            proposals.push({ siteId: site.siteId, field, value, provider: record.provider, reference: record.reference, retrievedAt: record.retrievedAt });
          } else if (existing.some(v => !sameValue(field, v, value))) {
            conflicts.push({ siteId: site.siteId, field, external: value, federato: existing, provider: record.provider, reference: record.reference, retrievedAt: record.retrievedAt });
          }
        }
        const advisory = provider?.advisory;
        if (advisory && record.fields?.[advisory.field] != null) {
          const value = String(record.fields[advisory.field]);
          if ((advisory.elevatedWhen ?? []).some(match => value.toUpperCase().startsWith(match))) {
            flags.push({ siteId: site.siteId, field: advisory.field, value, message: advisory.message, provider: record.provider, reference: record.reference, retrievedAt: record.retrievedAt });
          }
        }
      }
    }

    const tasks = [
      ...(row.tasks ?? []).filter(task => task.factorKey !== 'external'),
      ...conflicts.map(conflict => ({
        id: `${row.id}:conflict:${conflict.siteId}:${conflict.field}`,
        submissionId: row.id, submissionNumber: row.submissionNumber, accountName: row.accountName,
        factorKey: 'external', label: 'External data conflict', status: 'conflict',
        confidence: CONFIDENCE.CONFLICTED, severity: 'blocking',
        question: `${conflict.provider} reports ${conflict.field} as ${conflict.external}, but Federato holds ${conflict.federato.join(', ')}. Which is correct?`,
        needs: [`Confirm ${conflict.field} for Location:${conflict.siteId}`],
        askOf: ['broker'], enrichable: false, pointsAtStake: 0, external: conflict,
      })),
      ...flags.map(flag => ({
        id: `${row.id}:flag:${flag.siteId}:${flag.field}`,
        submissionId: row.id, submissionNumber: row.submissionNumber, accountName: row.accountName,
        factorKey: 'external', label: 'External risk signal', status: 'advisory',
        confidence: CONFIDENCE.EXTERNAL, severity: 'material',
        question: `${flag.message} (${flag.field}: ${flag.value}). Confirm whether this changes terms.`,
        needs: [`Review ${flag.field} for Location:${flag.siteId}`],
        askOf: ['underwriter'], enrichable: false, pointsAtStake: 0, external: flag,
      })),
      ...proposals.map(proposal => ({
        id: `${row.id}:proposal:${proposal.siteId}:${proposal.field}`,
        submissionId: row.id, submissionNumber: row.submissionNumber, accountName: row.accountName,
        factorKey: 'external', label: 'Proposed external value', status: 'proposed',
        confidence: CONFIDENCE.EXTERNAL, severity: 'minor',
        question: `${proposal.provider} reports ${proposal.field} as ${proposal.value} for Location:${proposal.siteId}. Accept as evidence?`,
        needs: [`Confirm ${proposal.field}`], askOf: ['underwriter'], enrichable: false,
        pointsAtStake: 0, external: proposal,
      })),
    ];

    return {
      ...row, tasks,
      external: {
        version: enrichment.version ?? 1,
        evidence, proposals, conflicts, flags,
        lookups: sites.map(site => ({
          siteId: site.siteId,
          address: [site.resolved?.address, site.resolved?.city, site.resolved?.state].filter(Boolean).join(', '),
          coordinateBasis: site.evidence.some(e => e.provider === 'census-geocode' && e.status === 'ok')
            ? 'Census address match' : 'Federato coordinates; address match unconfirmed',
          evidence: site.evidence,
        })),
        retrievedAt: enrichment.generatedAt,
        providers: enrichment.providerNames,
        verificationStatus: 'unreviewed',
      },
    };
  });
}
