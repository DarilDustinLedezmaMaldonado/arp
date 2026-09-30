'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, event } = require('./fixture');
const { authoritativeApply: apply, recoverDecisions, mirrorConfirmed } = require('../server/services/syncCore');
const { tick: refunds } = require('../server/sync/refundWorker');
const { applyOverlay } = require('../shared/seatMap');

test('20 concurrent purchases, stale causal claims and check-in cannot replace the winner', async t => {
  const ctx = await fixture(t);
  const all = await Promise.all(Array.from({ length: 20 }, (_, i) => apply(ctx, event(`TX-${i}`))));
  assert.equal(all.filter(r => r.tx.status === 'SOLD').length, 1);
  assert.equal(all.filter(r => r.tx.status === 'CONFLICT_LOST').length, 19);
  const winner = all.find(r => r.tx.status === 'SOLD').tx;
  assert.equal((await apply(ctx, event('late', 'PURCHASE', { lamportTs: 100 }))).tx.status, 'CONFLICT_LOST');
  assert.equal((await apply(ctx, event('check', 'CHECKIN', { basedOnTxId: winner.id }))).tx.status, 'CHECKED_IN');
  assert.equal((await apply(ctx, event('after-check'))).tx.status, 'CONFLICT_LOST');
  assert.equal((await apply(ctx, event(winner.id))).tx.id, winner.id);
});

test('journal replays a primary write after crash before outbox commit', async t => {
  const ctx = await fixture(t);
  ctx.systemStore.commitDecision = () => { throw new Error('simulated crash'); };
  await assert.rejects(apply(ctx, event('crash')), /simulated crash/);
  assert.equal((await ctx.primaryAdapter.getOwnedTransactionById('crash')).status, 'SOLD');
  ctx.restart();
  await recoverDecisions(ctx);
  assert.equal(ctx.systemStore.preparedDecisions().length, 0);
  assert.equal(ctx.systemStore.listAllPendingOutbox().length, 2);
  await recoverDecisions(ctx);
  await apply(ctx, event('crash'));
  assert.equal((await ctx.primaryAdapter.getAllOwnedTransactions()).length, 1);
  assert.equal(ctx.systemStore.listAllPendingOutbox().length, 2);
});

test('intent survives failure before primary write and blocks a second winner', async t => {
  const ctx = await fixture(t);
  const write = ctx.primaryAdapter.upsertReplicatedTransaction.bind(ctx.primaryAdapter);
  ctx.primaryAdapter.upsertReplicatedTransaction = async () => { throw new Error('DB offline'); };
  await assert.rejects(apply(ctx, event('first')), /DB offline/);
  ctx.primaryAdapter.upsertReplicatedTransaction = write;
  ctx.restart();
  assert.equal((await apply(ctx, event('second'))).tx.status, 'CONFLICT_LOST');
  assert.equal((await ctx.primaryAdapter.getOwnedTransactionById('first')).status, 'SOLD');
});

test('refund completes once on owner; retries and foreign workers never free a resale', async t => {
  const ctx = await fixture(t);
  const foreign = await fixture(t, 'NODE_EA');
  await apply(ctx, event('sale'));
  const refund = (await apply(ctx, event('refund', 'REFUND', { basedOnTxId: 'sale' }))).tx;
  await mirrorConfirmed(foreign, refund);
  await refunds(foreign);
  assert.equal((await foreign.primaryAdapter.getAllOwnedTransactions()).length, 1);
  await Promise.all([refunds(ctx), refunds(ctx)]);
  ctx.restart();
  await refunds(ctx);
  assert.equal((await ctx.primaryAdapter.getAllOwnedTransactions()).filter(r => r.actionType === 'REFUND_COMPLETE').length, 1);
  assert.equal((await apply(ctx, event('resale'))).tx.status, 'SOLD');
  await refunds(ctx);
  assert.equal((await apply(ctx, event('stale-refund', 'REFUND', { basedOnTxId: 'sale' }))).tx.status, 'REJECTED');
  const map = ctx.bookingService.liveSeatMap('F-TEST');
  assert.equal(map.seats.find(s => s.seatNumber === '1A').txId, 'resale');
  assert.equal(ctx.systemStore.globalAggregates().find(r => r.status === 'SOLD').cnt, 1);
});

test('late mirrors cannot resurrect conflict losers or downgrade confirmation', async t => {
  const ctx = await fixture(t, 'NODE_EA');
  const confirmed = { ...event('tx'), status: 'SOLD', syncStatus: 'SYNCED', lamportTs: 5 };
  const lost = { ...confirmed, status: 'CONFLICT_LOST' };
  await mirrorConfirmed(ctx, lost);
  await mirrorConfirmed(ctx, confirmed);
  ctx.systemStore.upsertReplicaTx(event('tx'));
  assert.equal((await ctx.primaryAdapter.getOwnedTransactionById('tx')).status, 'CONFLICT_LOST');
  assert.equal(ctx.systemStore.getReplicaTxById('tx').status, 'CONFLICT_LOST');
  await mirrorConfirmed(ctx, { ...confirmed, id: 'valid' });
  ctx.systemStore.upsertReplicaTx(event('valid'));
  assert.equal(ctx.systemStore.getReplicaTxById('valid').syncStatus, 'SYNCED');
});

test('offline purchase is durable pending, no sold seat, confirmed only after recovery', async t => {
  const ctx = await fixture(t);
  ctx.down = true;
  const result = await ctx.bookingService.requestSeatAction({ flightId: 'F-TEST', seatNumber: '1A', actionType: 'PURCHASE', passengerName: 'Demo' });
  assert.equal(result.tx.status, 'PENDING');
  assert.equal(result.pendingSync, true);
  assert.equal(applyOverlay([{ seatNumber: '1A', status: 'AVAILABLE' }], [result.tx])[0].status, 'AVAILABLE');
  ctx.restart();
  const queued = ctx.systemStore.listAllPendingOutbox();
  assert.equal(queued.length, 1);
  ctx.down = false;
  const accepted = await apply(ctx, queued[0].payload.event);
  assert.equal(accepted.tx.status, 'SOLD');
  assert.equal(ctx.systemStore.getReplicaTxById(result.tx.id).status, 'SOLD');
});
