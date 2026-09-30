'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SqliteAdapter } = require('../server/db/adapters/sqliteAdapter');
const { SystemStore } = require('../server/db/systemStore');
const { ClockService } = require('../server/services/clockService');
const { BookingService } = require('../server/services/bookingService');

async function fixture(t, nodeId = 'NODE_NA') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arp-tests-'));
  const primaryAdapter = new SqliteAdapter(nodeId, dir);
  await primaryAdapter.init();
  const ctx = { nodeId, primaryAdapter, systemStore: new SystemStore(nodeId, dir),
    flight: { id: 'F-TEST', origin: 'LAX', destination: 'SAO', date: '2026-10-15', time: '09:30', gate: 'A7',
      aircraftModel: 'B777', priceEconomy: 100, priceFirst: 200, ownerNode: 'NODE_NA' },
    down: false, partitioned: false,
    configService: { getAll: () => ({ soldPct: 0, reservedPct: 0, refundDelaySeconds: 0 }) } };
  ctx.flightCache = { get: id => id === ctx.flight.id ? ctx.flight : null };
  ctx.faultService = { isDbDown: () => ctx.down, isNetworkPartitioned: () => ctx.partitioned };
  ctx.clockService = new ClockService(nodeId, ctx.systemStore);
  ctx.bookingService = new BookingService(ctx);
  ctx.restart = () => {
    ctx.systemStore.db.close();
    ctx.systemStore = new SystemStore(nodeId, dir);
    ctx.clockService = new ClockService(nodeId, ctx.systemStore);
  };
  t.after(async () => { ctx.systemStore.db.close(); await primaryAdapter.close(); fs.rmSync(dir, { recursive: true }); });
  return ctx;
}
function event(id, actionType = 'PURCHASE', extra = {}) {
  return { id, flightId: 'F-TEST', seatNumber: '1A', cabinClass: 'FIRST', actionType, status: 'PENDING',
    originNode: 'NODE_EA', ownerNode: 'NODE_NA', passengerName: id, price: 200, pnr: 'ABC123',
    lamportTs: 1, vectorClock: { NODE_NA: 0, NODE_EA: 1, NODE_SA: 0 },
    syncStatus: 'LOCAL_PENDING', createdAt: new Date().toISOString(), ...extra };
}
module.exports = { fixture, event };
