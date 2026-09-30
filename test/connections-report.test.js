'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./fixture');
const { ConnectionTracker } = require('../server/services/connectionTracker');

test('Conexiones: una sesion por cliente, nueva tras 30 min sin actividad, y conteo de compras', async (t) => {
  const ctx = await fixture(t);
  let clock = Date.parse('2026-09-30T10:00:00Z');
  const tracker = new ConnectionTracker(ctx.systemStore, { now: () => clock });

  const a1 = tracker.touch('cliente-A', '10.0.0.1');
  clock += 60 * 1000;
  const a2 = tracker.touch('cliente-A', '10.0.0.1');
  assert.equal(a1.id, a2.id, 'dentro de 30 min es la misma conexion');
  tracker.countPurchase(a2);

  tracker.touch('cliente-B', '10.0.0.2');
  clock += 31 * 60 * 1000;
  const a3 = tracker.touch('cliente-A', '10.0.0.1');
  assert.notEqual(a3.id, a1.id, 'tras 30 min sin actividad es una conexion nueva');
  tracker.flush();

  const s = ctx.systemStore.connectionStats(clock);
  assert.equal(s.connections, 3);
  assert.equal(s.clients, 2);
  assert.equal(s.purchaseConnections, 1);
  assert.equal(s.purchaseRequests, 1);
  assert.equal(s.requests, 4);
  assert.equal(s.activeNow, 1);
});

test('Conexiones: sin identificador del navegador se usa un hash de IP + navegador', () => {
  const req = (headers, ip) => ({ ip, get: (h) => headers[h.toLowerCase()] });
  const id1 = ConnectionTracker.clientIdFor(req({ 'user-agent': 'Firefox' }, '10.0.0.1'));
  const id2 = ConnectionTracker.clientIdFor(req({ 'user-agent': 'Firefox' }, '10.0.0.1'));
  const id3 = ConnectionTracker.clientIdFor(req({ 'user-agent': 'Chrome' }, '10.0.0.1'));
  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.equal(ConnectionTracker.clientIdFor(req({ 'x-client-id': 'abc12345-uuid' }, '1.1.1.1')), 'abc12345-uuid');
  assert.match(ConnectionTracker.clientIdFor(req({ 'x-client-id': 'mal<script>' }, '1.1.1.1')), /^anon-/);
});
