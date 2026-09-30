'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FlightCache } = require('../server/services/flightCache');

function cacheWith(flights) {
  const cache = new FlightCache(null);
  for (const f of flights) cache.byId.set(f.id, f);
  return cache;
}

const flight = (id, origin, destination, date, time, timeHours, priceEconomy = 100) =>
  ({ id, origin, destination, date, time, timeHours, priceEconomy });

test('Conexiones: toma el segundo tramo mas temprano que respeta la escala minima', () => {
  const cache = cacheWith([
    flight('A', 'ATL', 'TYO', '2026-09-27', '00:00', 16),
    flight('B1', 'TYO', 'CAN', '2026-09-27', '16:30', 4), // solo 30 min de escala: no alcanza
    flight('B2', 'TYO', 'CAN', '2026-09-27', '18:00', 4),
    flight('B3', 'TYO', 'CAN', '2026-09-27', '20:00', 4),
  ]);
  const { total, rows } = cache.connections({ origin: 'ATL', destination: 'CAN', date: '2026-09-27' });
  assert.equal(total, 1);
  assert.deepEqual(rows[0].legs.map((f) => f.id), ['A', 'B2']);
  assert.equal(rows[0].hub, 'TYO');
  assert.equal(rows[0].layoverMinutes, 120);
  assert.equal(rows[0].totalMinutes, 22 * 60);
  assert.equal(rows[0].priceEconomy, 200);
});

test('Conexiones: descarta escalas de mas de 24 h y el propio destino como escala', () => {
  const cache = cacheWith([
    flight('A', 'ATL', 'TYO', '2026-09-30', '10:00', 16),
    flight('B', 'TYO', 'CAN', '2026-11-01', '10:00', 4),
    flight('D', 'ATL', 'CAN', '2026-09-30', '10:00', 20),
  ]);
  assert.equal(cache.connections({ origin: 'ATL', destination: 'CAN' }).total, 0);
});
