'use strict';
const { v4: uuidv4 } = require('uuid');

function newTxId(nodeId) {
  return `TX-${nodeId}-${Date.now().toString(36)}-${uuidv4().slice(0, 8)}`;
}

function newFlightId(index) {
  return `F-${String(index).padStart(6, '0')}`;
}

function newPnr(rng) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const r = rng || Math.random;
  for (let i = 0; i < 6; i++) out += chars[Math.floor(r() * chars.length)];
  return out;
}

module.exports = { newTxId, newFlightId, newPnr };
