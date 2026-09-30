'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { generateKeyPairSync } = require('crypto');
const { fixture, event } = require('./fixture');
const { guard, validateSecurity } = require('../server/middleware/auth');
const { buildSyncRouter } = require('../server/routes/sync');
const { buildWalletRouter } = require('../server/routes/wallet');
const { tick } = require('../server/sync/outboxWorker');

test('secure configuration fails closed', () => {
  assert.throws(() => validateSecurity({}), /SYNC_SECRET/);
  assert.throws(() => validateSecurity({ ALLOW_INSECURE_LOCAL: 'true', DB_DRIVER: 'sqlite', BIND_HOST: '0.0.0.0' }), /127.0.0.1/);
  validateSecurity({ ALLOW_INSECURE_LOCAL: 'true', DB_DRIVER: 'sqlite', BIND_HOST: '127.0.0.1' });
});

test('three HTTP nodes authenticate, arbitrate purchases and retry replication after DB recovery', async t => {
  const security = { SYNC_SECRET: 's'.repeat(32), ADMIN_SECRET: 'a'.repeat(32) };
  const saved = new Map();
  const setEnv = (key, value) => { if (!saved.has(key)) saved.set(key, process.env[key]); process.env[key] = value; };
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const nodes = [];
  for (const id of ['NODE_NA', 'NODE_EA', 'NODE_SA']) {
    const ctx = await fixture(t, id);
    const app = express();
    app.use(express.json());
    app.use('/internal/sync', guard('sync', security), buildSyncRouter(ctx));
    app.get('/admin', guard('admin', security), (_req, res) => res.json({ ok: true }));
    app.use('/api', buildWalletRouter(ctx));
    const server = await new Promise((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.on('error', reject);
    });
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    ctx.url = `http://127.0.0.1:${server.address().port}`;
    setEnv(`${id}_HOST`, '127.0.0.1'); setEnv(`${id}_PORT`, String(server.address().port));
    nodes.push(ctx);
  }
  setEnv('SYNC_SECRET', security.SYNC_SECRET);
  const [owner, ea, sa] = nodes;
  const post = (ctx, payload, headers = {}) => fetch(`${ctx.url}/internal/sync/event`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload),
  });
  const headers = { 'X-Sync-Secret': security.SYNC_SECRET, 'X-Node-ID': 'NODE_EA' };
  const payload = { kind: 'SEAT_TX_REQUEST', event: event('purchase-a') };
  assert.equal((await post(owner, payload)).status, 401);
  assert.equal((await fetch(`${owner.url}/admin`)).status, 401);
  assert.equal((await fetch(`${owner.url}/admin`, { headers: { 'X-Admin-Secret': security.ADMIN_SECRET } })).status, 200);
  assert.equal((await post(owner, payload, { ...headers, 'X-Node-ID': 'UNKNOWN' })).status, 403);
  const responses = await Promise.all([
    post(owner, payload, headers),
    post(owner, { kind: 'SEAT_TX_REQUEST', event: event('purchase-b', 'PURCHASE', { originNode: 'NODE_SA' }) }, { ...headers, 'X-Node-ID': 'NODE_SA' }),
  ]);
  const results = await Promise.all(responses.map(r => { assert.equal(r.status, 200); return r.json(); }));
  assert.equal(results.filter(r => r.tx.status === 'SOLD').length, 1);
  const winner = results.find(r => r.tx.status === 'SOLD').tx;
  assert.equal((await post(sa, { kind: 'CACHE_MIRROR', event: winner }, headers)).status, 403);
  ea.down = true;
  setEnv('NODE_ID', 'NODE_NA');
  await tick(owner);
  assert.equal(owner.systemStore.listAllPendingOutbox().length, 2);
  assert.equal((await sa.primaryAdapter.getAllOwnedTransactions()).length, 2);
  ea.down = false;
  await tick(owner);
  assert.equal(owner.systemStore.listAllPendingOutbox().length, 0);
  for (const ctx of nodes) {
    const rows = await ctx.primaryAdapter.getAllOwnedTransactions();
    assert.equal(rows.filter(tx => tx.status === 'SOLD').length, 1);
    assert.equal(ctx.bookingService.latestTxForSeat('F-TEST', '1A').id, winner.id);
  }
  ea.systemStore.savePending(event('pending', 'PURCHASE', { seatNumber: '1B' }));
  for (const suffix of ['qrcode.png', 'pdf', 'pkpass']) {
    assert.equal((await fetch(`${ea.url}/api/wallet/pending/${suffix}`)).status, 409);
  }
  assert.equal((await fetch(`${ea.url}/api/wallet/${winner.id}/qrcode.png`)).status, 200);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  setEnv('GOOGLE_WALLET_ISSUER_ID', '338800000000000001');
  setEnv('GOOGLE_WALLET_CLIENT_EMAIL', 'wallet@example.iam.gserviceaccount.com');
  setEnv('GOOGLE_WALLET_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const google = await fetch(`${ea.url}/api/wallet/${winner.id}/google`, { redirect: 'manual' });
  assert.equal(google.status, 302);
  const saveUrl = google.headers.get('location');
  assert.match(saveUrl, /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  const token = saveUrl.split('/').at(-1);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(claims.payload.genericObjects[0].header.defaultValue.value, 'LAX → SAO');
  assert.equal(claims.payload.genericObjects[0].barcode.value, `ARP|${winner.id}|NODE_EA`);
});
