'use strict';

const { KeyedMutex, seatKey } = require('./mutex');
const { isEffective, acceptsReplica } = require('../../shared/transactionState');
const { generateBaseSeatMap } = require('../../shared/seatMap');
const { isSellable } = require('../../shared/flightStatus');
const nodes = Object.keys(require('../../config/nodes.json').nodes);
const mutex = new KeyedMutex();
const lockKey = (ctx, event) => `${ctx.nodeId}:${seatKey(event.flightId, event.seatNumber)}`;
const actionStatus = { PURCHASE: 'SOLD', RESERVE: 'RESERVED', CANCEL: 'AVAILABLE',
  REFUND: 'REFUNDED', CHECKIN: 'CHECKED_IN', REFUND_COMPLETE: 'AVAILABLE' };

function unavailable() {
  return Object.assign(new Error('El nodo dueño no puede confirmar en este momento.'), { statusCode: 503, code: 'DB_DOWN' });
}

async function persistDecision(ctx, tx) {
  // Intent is fsynced BEFORE the primary write; replay uses the same id and
  // decision. Cache + outgoing messages + journal acknowledgement are atomic.
  await ctx.primaryAdapter.upsertReplicatedTransaction(tx);
  ctx.systemStore.commitDecision(tx, nodes.filter((n) => n !== ctx.nodeId));
}

async function recoverDecisions(ctx) {
  if (ctx.faultService.isDbDown()) return;
  for (const tx of ctx.systemStore.preparedDecisions()) {
    await mutex.run(lockKey(ctx, tx), () => persistDecision(ctx, tx));
  }
}

async function authoritativeApply(ctx, event) {
  const flight = ctx.flightCache.get(event.flightId);
  if (!flight || flight.ownerNode !== ctx.nodeId) {
    throw Object.assign(new Error('Este nodo no es el dueño del vuelo.'), { statusCode: 409, code: 'NOT_OWNER' });
  }
  if (!actionStatus[event.actionType]) throw Object.assign(new Error('Acción inválida'), { statusCode: 400, code: 'BAD_ACTION' });
  return mutex.run(lockKey(ctx, event), async () => {
    if (ctx.faultService.isDbDown()) throw unavailable();
    for (const prepared of ctx.systemStore.preparedDecisions()) {
      if (prepared.flightId === event.flightId && prepared.seatNumber === event.seatNumber) await persistDecision(ctx, prepared);
    }
    const already = await ctx.primaryAdapter.getOwnedTransactionById(event.id);
    if (already) {
      ctx.systemStore.commitDecision(already, nodes.filter((n) => n !== ctx.nodeId));
      return resultFor(already);
    }
    const history = (await ctx.primaryAdapter.getOwnedTransactionsForFlight(event.flightId))
      .filter((tx) => tx.seatNumber === event.seatNumber && isEffective(tx))
      .sort((a, b) => b.lamportTs - a.lamportTs || b.id.localeCompare(a.id));
    const current = history[0];
    const cfg = ctx.configService.getAll();
    const base = generateBaseSeatMap(flight.id, flight.aircraftModel, cfg,
      { economy: flight.priceEconomy, first: flight.priceFirst }).find((s) => s.seatNumber === event.seatNumber);
    if (!base) throw Object.assign(new Error('Asiento inexistente'), { statusCode: 404, code: 'SEAT_NOT_FOUND' });
    const state = current ? current.status : base.status;
    const claim = ['PURCHASE', 'RESERVE'].includes(event.actionType);
    const expected = { CANCEL: 'RESERVED', REFUND: 'SOLD', CHECKIN: 'SOLD', REFUND_COMPLETE: 'REFUNDED' };
    const upgrade = event.actionType === 'PURCHASE' && state === 'RESERVED' && current && event.basedOnTxId === current.id;
    let rejected = claim ? state !== 'AVAILABLE' && !upgrade
      : !current || current.id !== event.basedOnTxId || state !== expected[event.actionType];
    if (event.actionType === 'REFUND_COMPLETE' && current &&
        (!current.refundAvailableAt || Date.parse(current.refundAvailableAt) > Date.now())) rejected = true;
    // El dueno tiene la ultima palabra: un vuelo cancelado, embarcando o ya salido no se vende.
    const closed = claim && !isSellable(flight.status);

    // First accepted decision wins. A later request cannot revoke an issued
    // ticket. Owner clock orders transitions even when origin clocks lag.
    ctx.clockService.receiveRemote(Math.max(event.lamportTs || 0, current?.lamportTs || 0), event.vectorClock || {});
    const stamp = ctx.clockService.nextLocal();
    const tx = { ...event, ...stamp, ownerNode: ctx.nodeId, syncStatus: 'SYNCED',
      cabinClass: base.cabinClass,
      price: base.cabinClass === 'FIRST' ? flight.priceFirst : flight.priceEconomy,
      status: closed ? 'REJECTED' : rejected ? (claim ? 'CONFLICT_LOST' : 'REJECTED') : actionStatus[event.actionType],
      conflictReason: closed ? `Vuelo ${flight.id} en estado ${flight.status}: ya no está a la venta.`
        : rejected ? `Estado ${state}: la solicitud ya no corresponde al asiento.` : null,
      refundAvailableAt: !rejected && event.actionType === 'REFUND'
        ? new Date(Date.now() + cfg.refundDelaySeconds * 1000).toISOString() : null };
    ctx.systemStore.prepareDecision(tx);
    await persistDecision(ctx, tx);
    ctx.systemStore.appendEvent({ id: `EVT-${tx.id}`, eventType: rejected || closed ? 'SEAT_REQUEST_REJECTED' : 'SEAT_TX_APPLIED',
      summary: `${tx.actionType} ${tx.seatNumber} en ${tx.flightId} (${tx.status})`,
      originNode: tx.originNode, lamportTs: tx.lamportTs, vectorClock: tx.vectorClock });
    return resultFor(tx);
  });
}

function resultFor(tx) {
  return { tx, conflict: tx.status === 'CONFLICT_LOST', superseded: null, pendingSync: false };
}

async function mirrorConfirmed(ctx, event) {
  if (event.syncStatus !== 'SYNCED') throw Object.assign(new Error('Sólo se replican decisiones confirmadas.'), { statusCode: 400 });
  return mutex.run(lockKey(ctx, event), async () => {
    if (ctx.faultService.isDbDown()) throw unavailable();
    const previous = await ctx.primaryAdapter.getOwnedTransactionById(event.id);
    if (acceptsReplica(previous, event)) await ctx.primaryAdapter.upsertReplicatedTransaction(event);
    ctx.systemStore.upsertReplicaTx(acceptsReplica(previous, event) ? event : previous);
  });
}

module.exports = { authoritativeApply, recoverDecisions, mirrorConfirmed };
