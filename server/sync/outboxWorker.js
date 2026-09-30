'use strict';
const { sendSyncEvent, sendConfigUpdate, sendPricingUpdate } = require('./replicationClient');
const { authoritativeApply, recoverDecisions, mirrorConfirmed } = require('../services/syncCore');

async function tick(ctx) {
  await recoverDecisions(ctx);
  for (const item of ctx.systemStore.listAllPendingOutbox()) {
    if (item.target_node !== ctx.nodeId && ctx.faultService.isNetworkPartitioned()) continue;
    ctx.systemStore.bumpOutboxAttempt(item.id);
    try {
      const payload = item.payload;
      // Older versions broadcast provisional states; these must never become tickets.
      if (payload.kind === 'CACHE_MIRROR' && payload.event.syncStatus !== 'SYNCED') {
        ctx.systemStore.markOutboxDelivered(item.id);
        continue;
      }
      if (payload.kind === 'CONFIG_UPDATE') {
        await sendConfigUpdate(item.target_node, payload);
      } else if (payload.kind === 'PRICING_UPDATE') {
        await sendPricingUpdate(item.target_node, { kind: payload.matrixKind, order: payload.order, matrix: payload.matrix });
      } else if (payload.kind === 'SEAT_TX_REQUEST') {
        const response = item.target_node === ctx.nodeId
          ? await authoritativeApply(ctx, payload.event) : await sendSyncEvent(item.target_node, payload);
        await mirrorConfirmed(ctx, response.tx);
      } else {
        await sendSyncEvent(item.target_node, payload);
      }
      ctx.systemStore.markOutboxDelivered(item.id);
    } catch (err) {
      // Durable request/decision remains queued across outages and restarts.
    }
  }
}
function startOutboxWorker(ctx, intervalMs = 1000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(ctx); } catch (err) { console.error(`[${ctx.nodeId}] outbox:`, err.message); }
    finally { running = false; }
  }, intervalMs);
  timer.unref();
  return timer;
}
module.exports = { startOutboxWorker, tick };
