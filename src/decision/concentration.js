import { isPropertyCase } from './review.js';

const money = value => {
  if (value == null || !Number.isFinite(value)) return 'unknown TIV';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
};

const OPEN_LANES = new Set(['work-now', 'chase-evidence']);

function sameId(a, b) {
  return String(a) === String(b);
}

/**
 * Property peers already in the underwriter's queue (Federato only — no outside APIs).
 * Open lanes are what could still bind; declined peers are context for the same state pile.
 */
export function bookPeers(row, queue = []) {
  if (!isPropertyCase(row) || row.verdict === 'not-property') return [];
  const state = row.primaryState;
  if (!state) return [];
  return queue.filter(peer =>
    !sameId(peer.id, row.id)
    && isPropertyCase(peer)
    && peer.verdict !== 'not-property'
    && peer.primaryState === state);
}

/**
 * "If we bind this" concentration read against the rest of the ranked queue.
 * @param {Record<string, any>} row
 * @param {Record<string, any>[]} [queue]
 */
export function assessBookConcentration(row, queue = []) {
  if (!isPropertyCase(row) || row.verdict === 'not-property') {
    return {
      level: 'skip',
      tone: 'neutral',
      summary: 'Book concentration is only scored on commercial-property files.',
      peers: [],
      openPeers: [],
    };
  }

  const state = row.primaryState;
  if (!state) {
    return {
      level: 'unknown',
      tone: 'warn',
      summary: 'Primary risk state is missing, so I cannot check whether binding this loads one geography.',
      peers: [],
      openPeers: [],
      state: null,
    };
  }

  const peers = bookPeers(row, queue);
  const openPeers = peers.filter(peer => OPEN_LANES.has(peer.verdict));
  const selfTiv = Number(row.tiv) || 0;
  const openPeerTiv = openPeers.reduce((sum, peer) => sum + (Number(peer.tiv) || 0), 0);
  const openBookTiv = selfTiv + openPeerTiv;
  const statePeerTiv = peers.reduce((sum, peer) => sum + (Number(peer.tiv) || 0), 0) + selfTiv;

  const brokerId = row.brokerId;
  const brokerOpen = brokerId == null ? [] : queue.filter(peer =>
    !sameId(peer.id, row.id)
    && isPropertyCase(peer)
    && OPEN_LANES.has(peer.verdict)
    && peer.brokerId === brokerId);

  let level = 'clear';
  if (openPeers.length >= 3 || openBookTiv >= 250_000_000) level = 'heavy';
  else if (openPeers.length >= 1 || openBookTiv >= 100_000_000 || brokerOpen.length >= 2) level = 'caution';
  else if (peers.length >= 2 || statePeerTiv >= 100_000_000) level = 'caution';

  const names = openPeers.slice(0, 3).map(peer => peer.accountName ?? peer.submissionNumber ?? peer.id);
  const more = openPeers.length > names.length ? ` (+${openPeers.length - names.length} more)` : '';
  const declinedCount = peers.length - openPeers.length;
  const declinedPeers = peers.filter(peer => !OPEN_LANES.has(peer.verdict));

  let summary;
  if (openPeers.length === 0 && declinedCount > 0 && (peers.length >= 2 || statePeerTiv >= 100_000_000)) {
    level = 'caution';
    summary = `No other open ${state} files are waiting, but this pile already has ${declinedCount} declined ${state} property file(s). Together with this submission, ${state} TIV in the queue is about ${money(statePeerTiv)}. Binding this adds live ${state} exposure on a geography that already showed up a lot.`;
  } else if (level === 'clear') {
    summary = `${state} looks clear in this queue — no other property files share this state. If we bind this, we are not stacking ${state} exposure from this pile.`;
  } else if (level === 'heavy') {
    summary = `Heavy ${state} concentration: ${openPeers.length} other open property file(s) already carry ${money(openPeerTiv)} TIV`
      + (names.length ? ` — ${names.join(', ')}${more}` : '')
      + `. Binding this pushes the live ${state} book from this queue to about ${money(openBookTiv)}. Pause and look at the book, not only the file.`;
  } else {
    summary = `${state} is in appetite on this file, but the open queue already has ${openPeers.length} other ${state} property file(s)`
      + (names.length ? ` (${names.join(', ')}${more})` : '')
      + ` totaling ${money(openPeerTiv)} TIV. Binding this would put about ${money(openBookTiv)} ${state} TIV in play from this queue alone.`;
  }

  if (brokerOpen.length >= 2) {
    summary += ` Same broker also has ${brokerOpen.length} other open property submission(s) in this queue.`;
  }
  if (openPeers.length > 0 && declinedCount > 0) {
    summary += ` (${declinedCount} additional ${state} property file(s) are already declined in this pile; state TIV across all property peers + this file ≈ ${money(statePeerTiv)}.)`;
  }

  const listed = (openPeers.length ? openPeers : declinedPeers).slice(0, 5);

  return {
    level,
    tone: level === 'heavy' || level === 'caution' || level === 'unknown' ? 'warn' : 'good',
    summary,
    state,
    selfTiv,
    openPeerCount: openPeers.length,
    openPeerTiv,
    openBookTiv,
    statePeerCount: peers.length,
    statePeerTiv,
    brokerOpenCount: brokerOpen.length,
    peers: listed.map(peer => ({
      id: peer.id,
      accountName: peer.accountName,
      submissionNumber: peer.submissionNumber,
      verdict: peer.verdict,
      tiv: peer.tiv ?? null,
      score: peer.score ?? null,
    })),
  };
}

export function concentrationStep(concentration) {
  if (!concentration || concentration.level === 'skip') return null;
  return {
    kind: 'book',
    tone: concentration.tone,
    message: `If we bind this: ${concentration.summary}`,
  };
}
