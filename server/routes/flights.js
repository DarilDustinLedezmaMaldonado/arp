'use strict';

const express = require('express');
const airportsData = require('../../config/airports.json');
const aircraftData = require('../../config/aircraft.json');

function buildFlightsRouter(ctx) {
  const router = express.Router();

  router.get('/airports', (req, res) => {
    res.json({ order: airportsData.order, airports: airportsData.airports });
  });

  router.get('/aircraft', (req, res) => {
    res.json(aircraftData);
  });

  router.get('/routes', (req, res) => {
    res.json({ routes: ctx.flightCache.routes() });
  });

  router.get('/flights', (req, res) => {
    const { origin, destination, dateFrom, dateTo, status, sort, limit, offset } = req.query;
    const result = ctx.flightCache.search({
      origin: origin || undefined,
      destination: destination || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status: status || undefined,
      sort: sort || undefined,
      limit: limit ? Number(limit) : 30,
      offset: offset ? Number(offset) : 0,
    });
    res.json(result);
  });

  router.get('/flights/dates', (req, res) => {
    const { origin, destination, status } = req.query;
    res.json({ dates: ctx.flightCache.dates({ origin: origin || undefined, destination: destination || undefined, status: status || undefined }) });
  });

  router.get('/flights/status-counts', (req, res) => {
    const { origin, destination, dateFrom, dateTo } = req.query;
    res.json({ counts: ctx.flightCache.statusCounts({
      origin: origin || undefined, destination: destination || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    }) });
  });

  router.get('/flights/connections', (req, res) => {
    const { origin, destination, date, dateFrom, sort, limit } = req.query;
    res.json(ctx.flightCache.connections({
      origin: origin || undefined,
      destination: destination || undefined,
      date: date || undefined,
      dateFrom: dateFrom || undefined,
      sort: sort || undefined,
      limit: limit ? Math.min(Number(limit), 200) : 10,
    }));
  });

  router.get('/flights/:id', (req, res) => {
    const flight = ctx.flightCache.get(req.params.id);
    if (!flight) return res.status(404).json({ error: 'FLIGHT_NOT_FOUND' });
    res.json(flight);
  });

  router.get('/flights/:id/seatmap', (req, res) => {
    try {
      const { flight, seats, stats } = ctx.bookingService.liveSeatMap(req.params.id);
      res.json({ flight, seats, stats });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.code || 'INTERNAL_ERROR', message: err.message });
    }
  });

  return router;
}

module.exports = { buildFlightsRouter };
