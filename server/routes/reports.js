'use strict';

const express = require('express');
const aircraftConfig = require('../../config/aircraft.json');
const nodesConfig = require('../../config/nodes.json').nodes;
const { getModelKeyForAircraftId } = require('../../shared/seatMap');

/** Reportes que pidio el ingeniero (puntos extra). Solo lectura y sin datos sensibles (no expone IP). */
function buildReportsRouter(ctx) {
  const router = express.Router();

  // 1) Conexiones de clientes a ESTE servidor y cuantas fueron para comprar.
  router.get('/reports/connections', async (req, res) => {
    const stats = ctx.systemStore.connectionStats();
    let dbRecords = null;
    try {
      // Registros que los clientes dejaron en la base primaria de este nodo (decisiones de asiento que le pertenecen).
      if (!ctx.faultService.isDbDown()) dbRecords = (await ctx.primaryAdapter.getAllOwnedTransactions()).length;
    } catch { /* base caida: se informa como null */ }
    res.json({
      nodeId: ctx.nodeId,
      label: nodesConfig[ctx.nodeId].label,
      dbDriver: ctx.primaryAdapter.kind,
      ...stats,
      dbRecords,
      sessionGapMinutes: 30,
    });
  });

  // 2) Atajos para la lista de embarque: vuelos con pasajes reales.
  router.get('/reports/boarding-flights', (req, res) => {
    const flights = ctx.systemStore.flightsWithLiveTickets(8).map((r) => {
      const f = ctx.flightCache.get(r.flightId);
      return f && { ...r, origin: f.origin, destination: f.destination, date: f.date, time: f.time };
    }).filter(Boolean);
    res.json({ flights });
  });

  // 3) Flota: capacidad por clase de cada avion (aircraft_id del dataset) y cuantos vuelos tiene asignados.
  router.get('/reports/fleet', (req, res) => {
    const flightsByAircraft = new Map();
    for (const f of ctx.flightCache.all()) flightsByAircraft.set(f.aircraftId, (flightsByAircraft.get(f.aircraftId) || 0) + 1);
    const aircraft = [];
    for (const [key, m] of Object.entries(aircraftConfig.models)) {
      for (let id = m.idRange[0]; id <= m.idRange[1]; id++) {
        if (getModelKeyForAircraftId(id) !== key) continue;
        aircraft.push({ aircraftId: id, model: key, modelName: m.name, firstClass: m.firstClassSeats, economy: m.economySeats,
          total: m.firstClassSeats + m.economySeats, flights: flightsByAircraft.get(id) || 0 });
      }
    }
    aircraft.sort((a, b) => b.total - a.total || b.firstClass - a.firstClass || a.aircraftId - b.aircraftId);
    res.json({ aircraft, maxTotal: aircraft.length ? aircraft[0].total : 0 });
  });

  return router;
}

module.exports = { buildReportsRouter };
