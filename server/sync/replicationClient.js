'use strict';

const nodesConfig = require('../../config/nodes.json').nodes;
const { syncHeaders } = require('../middleware/auth');

const DEFAULT_TIMEOUT_MS = 2000;

function baseUrlFor(nodeId) {
  const n = nodesConfig[nodeId];
  if (!n) throw new Error(`Nodo desconocido: ${nodeId}`);
  const host = process.env[`${nodeId}_HOST`] || n.host;
  const port = process.env[`${nodeId}_PORT`] || n.port;
  return `http://${host}:${port}`;
}

/**
 * Envia un evento de sincronizacion al nodo destino. Se usa TANTO para el
 * "relay" sincrono (cuando un nodo no dueno reenvia una reserva al dueno)
 * COMO para el "gossip" de cache (mantener al tercer nodo al tanto). El nodo
 * receptor decide que hacer segun si el es o no el dueno del vuelo
 * (ver server/routes/sync.js).
 */
async function sendSyncEvent(targetNode, event, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${baseUrlFor(targetNode)}/internal/sync/event`;
  const res = await fetch(url, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Nodo ${targetNode} respondio ${res.status}: ${text}`), { statusCode: res.status });
  }
  return res.json();
}

async function sendConfigUpdate(targetNode, payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${baseUrlFor(targetNode)}/internal/sync/config`;
  const res = await fetch(url, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Nodo ${targetNode} respondio ${res.status}`);
  return res.json();
}

async function sendPricingUpdate(targetNode, payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${baseUrlFor(targetNode)}/internal/sync/pricing`;
  const res = await fetch(url, {
    method: 'POST',
    headers: syncHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Nodo ${targetNode} respondio ${res.status}`);
  return res.json();
}

async function pingNode(nodeId, { timeoutMs = 1200 } = {}) {
  try {
    const url = `${baseUrlFor(nodeId)}/health`;
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { nodeId, reachable: false, latencyMs: null };
    const body = await res.json();
    return { nodeId, reachable: true, latencyMs, ...body };
  } catch (err) {
    return { nodeId, reachable: false, latencyMs: null, error: err.message };
  }
}

module.exports = { sendSyncEvent, sendConfigUpdate, sendPricingUpdate, pingNode, baseUrlFor };
