'use strict';
const { authoritativeApply } = require('../services/syncCore');
const { isEffective } = require('../../shared/transactionState');

async function tick(ctx) {
  if (ctx.faultService.isDbDown()) return;
  const latest = new Map();
  for (const tx of await ctx.primaryAdapter.getAllOwnedTransactions()) {
    if (tx.ownerNode !== ctx.nodeId || !isEffective(tx)) continue;
    const key = `${tx.flightId}:${tx.seatNumber}`;
    if (!latest.has(key) || latest.get(key).lamportTs < tx.lamportTs) latest.set(key, tx);
  }
  for (const tx of latest.values()) {
    if (tx.status !== 'REFUNDED' || !tx.refundAvailableAt || Date.parse(tx.refundAvailableAt) > Date.now()) continue;
    const id = `RC-${require('crypto').createHash('sha256').update(tx.id).digest('hex').slice(0, 48)}`;
    await authoritativeApply(ctx, { ...tx, id, actionType: 'REFUND_COMPLETE',
      basedOnTxId: tx.id, originNode: ctx.nodeId, createdAt: new Date().toISOString() });
  }
}

function startRefundWorker(ctx, intervalMs = 5000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(ctx); } catch (err) { console.error(`[${ctx.nodeId}] refund:`, err.message); }
    finally { running = false; }
  }, intervalMs);
  timer.unref();
  return timer;
}
module.exports = { startRefundWorker, tick };
