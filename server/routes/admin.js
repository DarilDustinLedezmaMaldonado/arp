'use strict';

const express = require('express');
const pricing = require('../../shared/pricing');
const { parsePastedMatrix, matrixToTsv } = require('../../shared/matrixParser');
const airportsData = require('../../config/airports.json');
const nodesConfig = require('../../config/nodes.json').nodes;
const { pingNode, sendConfigUpdate } = require('../sync/replicationClient');
const { computeBaselineProjection, computeLiveActivity, computeFlightDashboard } = require('../services/dashboardService');

function buildAdminRouter(ctx) {
  const router = express.Router();
  const ALL_NODE_IDS = Object.keys(nodesConfig);

  router.get('/status', async (req, res) => {
    const peers = await Promise.all(ALL_NODE_IDS.filter((n) => n !== ctx.nodeId).map((n) => pingNode(n)));
    res.json({
      nodeId: ctx.nodeId,
      label: nodesConfig[ctx.nodeId].label,
      dbDriver: ctx.primaryAdapter.kind,
      ownsRegion: nodesConfig[ctx.nodeId].ownsRegion,
      faultState: ctx.faultService.state(),
      clocks: ctx.clockService.peek(),
      flightsLoaded: ctx.flightCache.byId.size,
      config: ctx.configService.getAll(),
      peers,
    });
  });

  router.post('/fault', (req, res) => {
    const { dbDown, networkPartitioned } = req.body;
    const next = ctx.faultService.store.setFaultState({ dbDown, networkPartitioned });
    ctx.systemStore.appendEvent({
      id: `EVT-FAULT-${Date.now()}`,
      eventType: 'FAULT_STATE_CHANGED',
      summary: `Estado de fallas de ${ctx.nodeId} cambiado a dbDown=${next.dbDown}, networkPartitioned=${next.networkPartitioned}`,
      originNode: ctx.nodeId,
      lamportTs: ctx.clockService.peek().lamportTs,
      vectorClock: ctx.clockService.peek().vectorClock,
    });
    res.json(next);
  });

  router.get('/config', (req, res) => res.json(ctx.configService.getAll()));

  router.post('/config', async (req, res) => {
    const { key, value } = req.body;
    const allowed = ['soldPct', 'reservedPct', 'refundDelaySeconds', 'currentSimulatedCountryNode'];
    if (!allowed.includes(key)) return res.status(400).json({ error: 'BAD_KEY', message: `key debe ser uno de ${allowed.join(', ')}` });
    const evt = ctx.configService.setLocal(key, value, ctx.clockService);
    for (const target of ALL_NODE_IDS.filter((n) => n !== ctx.nodeId)) {
      ctx.systemStore.enqueueOutbox({
        id: `OUTBOX-CFG-${key}-${ctx.nodeId}-${evt.lamportTs}-${target}`,
        targetNode: target, eventType: 'CONFIG_UPDATE',
        payload: { kind: 'CONFIG_UPDATE', ...evt },
      });
    }
    res.json(ctx.configService.getAll());
  });

  router.get('/events', (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(ctx.systemStore.recentEvents(limit));
  });

  router.get('/outbox', (req, res) => {
    res.json(ctx.systemStore.listAllPendingOutbox());
  });

  router.get('/dashboard/global', (req, res) => {
    const cfg = ctx.configService.getAll();
    const baseline = computeBaselineProjection(ctx.flightCache.all(), cfg);
    const live = computeLiveActivity(ctx);
    res.json({ baseline, live, airportsOrder: airportsData.order, nodes: nodesConfig });
  });

  router.get('/dashboard/flight/:id', (req, res) => {
    try {
      res.json(computeFlightDashboard(ctx, req.params.id));
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
    }
  });

  router.post('/reprice', async (req, res) => {
    try {
      const updates = ctx.flightCache.all().map((f) => ({
        id: f.id,
        priceEconomy: pricing.getPriceOrEstimate(f.origin, f.destination, 'ECONOMY').value,
        priceFirst: pricing.getPriceOrEstimate(f.origin, f.destination, 'FIRST').value,
        timeHours: pricing.getTime(f.origin, f.destination),
      }));
      await ctx.primaryAdapter.bulkUpdatePrices(updates);
      await ctx.flightCache.load();
      res.json({ ok: true, updated: updates.length });
    } catch (err) {
      res.status(500).json({ error: 'REPRICE_FAILED', message: err.message });
    }
  });

  // ---- Editor de matrices (pegar/exportar desde Excel) ----
  router.get('/matrix/:kind', (req, res) => {
    try {
      res.json(pricing.exportRaw(req.params.kind));
    } catch (err) {
      res.status(400).json({ error: 'BAD_KIND', message: err.message });
    }
  });

  router.get('/matrix/:kind/tsv', (req, res) => {
    try {
      const raw = pricing.exportRaw(req.params.kind);
      res.type('text/plain').send(matrixToTsv(raw.order, raw.matrix, airportsData.airports));
    } catch (err) {
      res.status(400).json({ error: 'BAD_KIND', message: err.message });
    }
  });

  router.post('/matrix/:kind', async (req, res) => {
    const { tsv } = req.body;
    if (!tsv) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Falta "tsv"' });
    try {
      const { order, matrix } = parsePastedMatrix(tsv);
      const saved = pricing.saveMatrix(req.params.kind, order, matrix, ctx.nodeId);
      for (const target of ALL_NODE_IDS.filter((n) => n !== ctx.nodeId)) {
        ctx.systemStore.enqueueOutbox({
          id: `OUTBOX-PRICING-${req.params.kind}-${target}-${require('crypto').randomUUID()}`,
          targetNode: target, eventType: 'PRICING_UPDATE',
          payload: { kind: 'PRICING_UPDATE', matrixKind: req.params.kind, order, matrix },
        });
      }
      res.json({ ok: true, saved });
    } catch (err) {
      res.status(400).json({ error: 'PARSE_ERROR', message: err.message });
    }
  });

  return router;
}

module.exports = { buildAdminRouter };
