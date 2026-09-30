'use strict';
const express = require('express');
const { authoritativeApply, mirrorConfirmed } = require('../services/syncCore');
const pricing = require('../../shared/pricing');
const nodes = require('../../config/nodes.json').nodes;

function buildSyncRouter(ctx) {
  const router = express.Router();
  router.post('/event', async (req, res) => {
    const { kind, event } = req.body;
    if (!event || !['SEAT_TX_REQUEST', 'CACHE_MIRROR'].includes(kind) ||
        typeof event.id !== 'string' || event.id.length > 64 ||
        typeof event.flightId !== 'string' || typeof event.seatNumber !== 'string' ||
        !nodes[event.originNode] || !Number.isSafeInteger(event.lamportTs) || event.lamportTs < 0 ||
        !event.vectorClock || Object.values(event.vectorClock).some(v => !Number.isSafeInteger(v) || v < 0)) {
      return res.status(400).json({ error: 'BAD_EVENT' });
    }
    const flight = ctx.flightCache.get(event.flightId);
    if (!flight) return res.status(404).json({ error: 'FLIGHT_NOT_FOUND' });
    const sender = req.get('x-node-id');
    if (event.ownerNode !== flight.ownerNode ||
        (kind === 'CACHE_MIRROR' && sender !== flight.ownerNode) ||
        (kind === 'SEAT_TX_REQUEST' && sender !== event.originNode)) {
      return res.status(403).json({ error: 'INVALID_AUTHORITY' });
    }
    try {
      ctx.clockService.receiveRemote(event.lamportTs, event.vectorClock);
      if (kind === 'CACHE_MIRROR') {
        if (ctx.nodeId === flight.ownerNode) return res.status(403).json({ error: 'OWNER_REJECTS_MIRROR' });
        await mirrorConfirmed(ctx, event);
        return res.json({ ok: true });
      }
      return res.json(await authoritativeApply(ctx, event));
    } catch (err) {
      return res.status(err.statusCode || 503).json({ error: err.code || 'PRIMARY_UNAVAILABLE', message: err.message });
    }
  });
  router.post('/config', (req, res) => {
    const { key, value, lamportTs } = req.body;
    ctx.clockService.receiveRemote(lamportTs || 0, {});
    ctx.configService.applyRemote(key, value, lamportTs || 0);
    res.json({ ok: true });
  });
  router.post('/pricing', (req, res) => {
    try {
      const { kind, order, matrix } = req.body;
      pricing.saveMatrix(kind, order, matrix, 'sync');
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: 'BAD_MATRIX', message: err.message }); }
  });
  return router;
}
module.exports = { buildSyncRouter };
