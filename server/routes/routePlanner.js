'use strict';

const express = require('express');
const { dijkstra } = require('../../shared/dijkstra');
const { solveTsp } = require('../../shared/tsp');
const pricing = require('../../shared/pricing');

function weightGraph(weight) {
  if (weight === 'TIME') return pricing.graphFor('TIME');
  if (weight === 'FIRST') return pricing.graphFor('FIRST');
  return pricing.graphFor('ECONOMY');
}

function buildRoutePlannerRouter(ctx) {
  const router = express.Router();

  router.get('/route/shortest', (req, res) => {
    const { from, to, weight = 'ECONOMY' } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'BAD_REQUEST', message: 'from y to son requeridos' });
    try {
      const graph = weightGraph(weight);
      const result = dijkstra(graph, from, to);
      if (!result) return res.status(404).json({ error: 'NO_ROUTE', message: `No existe ruta de ${from} a ${to}` });
      res.json({ from, to, weight, ...result });
    } catch (err) {
      res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
    }
  });

  router.post('/route/tsp', (req, res) => {
    const { airports, weight = 'ECONOMY', mode = 'PATH' } = req.body;
    if (!Array.isArray(airports) || airports.length < 2) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Se requieren al menos 2 aeropuertos' });
    }
    try {
      const graph = weightGraph(weight);
      const result = solveTsp(graph, airports, mode);
      if (!result) return res.status(404).json({ error: 'NO_ROUTE', message: 'No existe una ruta que cubra todos los aeropuertos pedidos' });
      res.json({ airports, weight, mode, ...result });
    } catch (err) {
      res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
    }
  });

  return router;
}

module.exports = { buildRoutePlannerRouter };
