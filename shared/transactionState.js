'use strict';

// Owner decisions are immutable. Only legacy conflict corrections may replace
// an already confirmed event; a delayed SOLD can never resurrect a loser.
function acceptsReplica(previous, incoming) {
  if (!previous) return true;
  if (previous.status === 'CONFLICT_LOST' || previous.status === 'REJECTED') return false;
  if (previous.syncStatus === 'SYNCED') {
    return incoming.syncStatus === 'SYNCED' && incoming.status === 'CONFLICT_LOST';
  }
  return incoming.syncStatus === 'SYNCED';
}

function isEffective(tx) {
  return tx.syncStatus === 'SYNCED' && !['CONFLICT_LOST', 'REJECTED', 'PENDING'].includes(tx.status);
}

module.exports = { acceptsReplica, isEffective };
