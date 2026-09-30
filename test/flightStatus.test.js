'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, event } = require('./fixture');
const { authoritativeApply: apply } = require('../server/services/syncCore');
const { FlightCache } = require('../server/services/flightCache');
const { SagaService } = require('../server/services/sagaService');
const { isSellable } = require('../shared/flightStatus');

test('Solo se venden vuelos programados o demorados', () => {
  assert.deepEqual(['SCHEDULED', 'DELAYED', 'BOARDING', 'DEPARTED', 'IN_FLIGHT', 'LANDED', 'CANCELLED'].map(isSellable),
    [true, true, false, false, false, false, false]);
});

test('El dueño rechaza reservas de un vuelo cancelado, pero no bloquea la devolución', async (t) => {
  const ctx = await fixture(t);
  const sold = (await apply(ctx, event('sale'))).tx;
  assert.equal(sold.status, 'SOLD');
  ctx.flight.status = 'CANCELLED';
  const late = (await apply(ctx, event('late', 'PURCHASE', { seatNumber: '1C' }))).tx;
  assert.equal(late.status, 'REJECTED');
  assert.match(late.conflictReason, /CANCELLED/);
  assert.equal((await apply(ctx, event('refund', 'REFUND', { basedOnTxId: 'sale' }))).tx.status, 'REFUNDED');
});

test('El nodo local rechaza antes de molestar al dueño', async (t) => {
  const ctx = await fixture(t);
  ctx.flight.status = 'DEPARTED';
  await assert.rejects(
    ctx.bookingService.requestSeatAction({ flightId: 'F-TEST', seatNumber: '1A', actionType: 'RESERVE', passengerName: 'Ana' }),
    (err) => err.code === 'FLIGHT_NOT_SELLABLE'
  );
  assert.equal(ctx.systemStore.listAllPendingOutbox().length, 0);
});

test('Filtros por estado, conteos y conexiones solo con tramos a la venta', () => {
  const cache = new FlightCache(null);
  const add = (id, origin, destination, time, status) => cache.byId.set(id, { id, origin, destination, date: '2026-09-30', time, timeHours: 2, status });
  add('A', 'ATL', 'TYO', '00:00', 'SCHEDULED');
  add('B', 'TYO', 'CAN', '04:00', 'CANCELLED');
  add('C', 'TYO', 'CAN', '05:00', 'DELAYED');
  add('D', 'ATL', 'TYO', '01:00', 'LANDED');
  assert.deepEqual(cache.search({ status: 'SCHEDULED,DELAYED' }).rows.map((f) => f.id), ['A', 'C']);
  assert.deepEqual(cache.statusCounts({ origin: 'ATL' }), { SCHEDULED: 1, LANDED: 1 });
  assert.deepEqual(cache.dates({ status: 'CANCELLED' }), [{ date: '2026-09-30', count: 1 }]);
  assert.deepEqual(cache.connections({ origin: 'ATL', destination: 'CAN' }).rows.map((c) => c.legs.map((f) => f.id)), [['A', 'C']]);
});

test('La saga no acepta tramos que ya no están a la venta', async (t) => {
  const ctx = await fixture(t);
  const flights = {
    'F-A': { id: 'F-A', origin: 'ATL', destination: 'TYO', date: '2026-09-27', time: '00:00', timeHours: 16, aircraftModel: 'B777', ownerNode: 'NODE_NA', status: 'SCHEDULED' },
    'F-B': { id: 'F-B', origin: 'TYO', destination: 'CAN', date: '2026-09-27', time: '18:00', timeHours: 4, aircraftModel: 'B777', ownerNode: 'NODE_NA', status: 'BOARDING' },
  };
  ctx.flightCache = { get: (id) => flights[id] || null };
  const saga = new SagaService(ctx);
  await assert.rejects(
    saga.start({ legs: [{ flightId: 'F-A', seatNumber: '1A' }, { flightId: 'F-B', seatNumber: '1A' }], passengerName: 'Ana' }),
    (err) => err.code === 'FLIGHT_NOT_SELLABLE'
  );
});
