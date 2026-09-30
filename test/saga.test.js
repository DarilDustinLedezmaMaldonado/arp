'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./fixture');
const { authoritativeApply: apply } = require('../server/services/syncCore');
const { SagaService } = require('../server/services/sagaService');

// Dos tramos que conectan en TYO (llega 16:00, sale 18:00). Por defecto ambos son de NODE_NA (local).
async function sagaFixture(t, { secondOwner = 'NODE_NA', reserveTimeoutSeconds = 60 } = {}) {
  const ctx = await fixture(t);
  const flights = {
    'F-A': { id: 'F-A', origin: 'ATL', destination: 'TYO', date: '2026-09-27', time: '00:00', timeHours: 16,
      aircraftModel: 'B777', priceEconomy: 100, priceFirst: 200, ownerNode: 'NODE_NA' },
    'F-B': { id: 'F-B', origin: 'TYO', destination: 'CAN', date: '2026-09-27', time: '18:00', timeHours: 4,
      aircraftModel: 'B777', priceEconomy: 50, priceFirst: 90, ownerNode: secondOwner },
  };
  ctx.flightCache = { get: (id) => flights[id] || null };
  ctx.sagaService = new SagaService(ctx, { reserveTimeoutSeconds });
  const seat = (flightId) => ctx.bookingService.findSeat(flightId, '1A');
  const legs = [{ flightId: 'F-A', seatNumber: '1A' }, { flightId: 'F-B', seatNumber: '1A' }];
  // Simula que el outbox trajo la decision del dueno remoto a la replica local.
  const ownerDecides = (txId, status) => {
    const tx = ctx.systemStore.getReplicaTxById(txId);
    ctx.systemStore.upsertReplicaTx({ ...tx, status, syncStatus: 'SYNCED', lamportTs: tx.lamportTs + 10 });
  };
  return { ctx, seat, legs, ownerDecides };
}

test('Saga: compra los dos tramos (reserva todo, luego compra todo)', async (t) => {
  const { ctx, seat, legs } = await sagaFixture(t);
  const saga = await ctx.sagaService.start({ legs, passengerName: 'Ana' });
  assert.equal(saga.status, 'COMPLETED');
  assert.deepEqual(saga.legs.map((l) => [l.reserve.status, l.purchase.status]), [['RESERVED', 'SOLD'], ['RESERVED', 'SOLD']]);
  assert.equal(seat('F-A').status, 'SOLD');
  assert.equal(seat('F-B').status, 'SOLD');
  assert.equal(ctx.sagaService.get(saga.id).status, 'COMPLETED');
});

test('Saga: si el segundo asiento ya esta vendido, cancela la reserva del primero', async (t) => {
  const { ctx, seat, legs } = await sagaFixture(t);
  await apply(ctx, { id: 'OTHER', flightId: 'F-B', seatNumber: '1A', actionType: 'PURCHASE', passengerName: 'Otro',
    originNode: 'NODE_NA', lamportTs: 1, vectorClock: {}, createdAt: new Date().toISOString() });
  ctx.systemStore.upsertReplicaTx(ctx.systemStore.getReplicaTxById('OTHER'));

  const saga = await ctx.sagaService.start({ legs, passengerName: 'Ana' });
  assert.equal(saga.status, 'ABORTED');
  assert.equal(saga.legs[0].reserve.status, 'RESERVED');
  assert.equal(saga.legs[0].compensation.actionType, 'CANCEL');
  assert.equal(saga.legs[0].compensation.status, 'AVAILABLE');
  assert.equal(saga.legs[1].reserve.status, 'REJECTED');
  assert.equal(saga.legs[1].compensation, null);
  assert.equal(seat('F-A').status, 'AVAILABLE');
  assert.equal(seat('F-B').txId, 'OTHER');
});

test('Saga: espera al dueno caido y continua cuando confirma', async (t) => {
  const { ctx, seat, legs, ownerDecides } = await sagaFixture(t, { secondOwner: 'NODE_EA' });
  ctx.partitioned = true;
  let saga = await ctx.sagaService.start({ legs, passengerName: 'Ana' });
  assert.equal(saga.status, 'RESERVING');
  assert.equal(saga.legs[1].reserve.status, 'PENDING');

  ownerDecides(saga.legs[1].reserve.txId, 'RESERVED');
  saga = await ctx.sagaService.advance(saga.id);
  assert.equal(saga.status, 'PURCHASING');
  assert.equal(saga.legs[0].purchase.status, 'SOLD');
  assert.equal(saga.legs[1].purchase.status, 'PENDING');

  ownerDecides(saga.legs[1].purchase.txId, 'SOLD');
  saga = await ctx.sagaService.advance(saga.id);
  assert.equal(saga.status, 'COMPLETED');
  assert.equal(seat('F-A').status, 'SOLD');
});

test('Saga: si la reserva no se confirma a tiempo, compensa y espera el resultado pendiente', async (t) => {
  const { ctx, seat, legs, ownerDecides } = await sagaFixture(t, { secondOwner: 'NODE_EA', reserveTimeoutSeconds: 0 });
  ctx.partitioned = true;
  let saga = await ctx.sagaService.start({ legs, passengerName: 'Ana' });
  await new Promise((r) => setTimeout(r, 5));
  saga = await ctx.sagaService.advance(saga.id);
  // El primer tramo se libera; el segundo aun no se sabe, asi que la saga no puede cerrar.
  assert.equal(saga.status, 'COMPENSATING');
  assert.equal(saga.legs[0].compensation.status, 'AVAILABLE');
  assert.equal(seat('F-A').status, 'AVAILABLE');

  ownerDecides(saga.legs[1].reserve.txId, 'CONFLICT_LOST');
  saga = await ctx.sagaService.advance(saga.id);
  assert.equal(saga.status, 'ABORTED');
  assert.equal(saga.legs[1].compensation, null);
});

test('Saga: rechaza itinerarios que no conectan', async (t) => {
  const { ctx } = await sagaFixture(t);
  await assert.rejects(
    ctx.sagaService.start({ legs: [{ flightId: 'F-B', seatNumber: '1A' }, { flightId: 'F-A', seatNumber: '1A' }], passengerName: 'Ana' }),
    /no conecta/
  );
});
