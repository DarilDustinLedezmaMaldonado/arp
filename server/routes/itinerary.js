'use strict';

const express = require('express');

function buildItineraryRouter(ctx) {
  const router = express.Router();

  const withFlights = (saga) => saga && {
    ...saga,
    legs: saga.legs.map((leg) => ({ ...leg, flight: ctx.flightCache.get(leg.flightId) })),
  };

  // Compra combinada: inicia la saga en ESTE nodo (orquestador) y devuelve su estado actual.
  router.post('/itineraries', async (req, res) => {
    const { legs, passengerName, passengerEmail } = req.body || {};
    ctx.connectionTracker?.countPurchase(req.clientSession);
    try {
      const saga = await ctx.sagaService.start({ legs, passengerName, passengerEmail });
      res.status(201).json(withFlights(saga));
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
    }
  });

  router.get('/itineraries', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json({ sagas: ctx.systemStore.recentSagas(limit).map(withFlights) });
  });

  router.get('/itineraries/:id', (req, res) => {
    const saga = ctx.sagaService.get(req.params.id);
    if (!saga) return res.status(404).json({ error: 'SAGA_NOT_FOUND', message: 'Itinerario no encontrado en este nodo.' });
    res.json(withFlights(saga));
  });

  return router;
}

module.exports = { buildItineraryRouter };
