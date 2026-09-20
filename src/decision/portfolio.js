/**
 * Flag taxonomy: pure re-presentation of a factor's status, never new appetite logic.
 * fail -> red (a real exception), unknown -> yellow (an evidence gap), everything
 * else (pass, target) -> preferred (wanted business).
 */
export function flagTone(status) {
  if (status === 'fail') return 'red';
  if (status === 'unknown') return 'yellow';
  if (status === 'pass' || status === 'target') return 'preferred';
  return 'yellow';
}

export function flagSummary(row) {
  const summary = { red: 0, yellow: 0, preferred: 0 };
  for (const factor of row.factors ?? []) summary[flagTone(factor.status)] += 1;
  return summary;
}

/** Factor reasons grouped by tone, for chip hover text. */
export function reasonsByTone(row) {
  const grouped = { red: [], yellow: [], preferred: [] };
  for (const factor of row.factors ?? []) grouped[flagTone(factor.status)].push(`${factor.label}: ${factor.reason}`);
  return grouped;
}

/** Count of unresolved required factors — the work left before a confident verdict. */
export function effortToDecision(row) {
  return (row.factors ?? []).filter(f => f.status === 'unknown').length;
}

/** Nothing left to chase. A case can be in good order and still fall outside appetite. */
export function inGoodOrder(row) {
  return effortToDecision(row) === 0;
}
