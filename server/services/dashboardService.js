'use strict';

const aircraftConfig = require('../../config/aircraft.json');

/**
 * Los totales "base" del dashboard global se calculan con VALOR ESPERADO
 * (n_asientos * 73%/3%) en vez de generar los ~15-20 millones de asientos
 * reales de los 60,000 vuelos (ver shared/seatMap.js para la justificacion
 * completa). Es estadisticamente correcto (ley de los grandes numeros) y
 * permite que el dashboard responda instantaneo.
 *
 * La actividad REAL de la demo (lo que de verdad reservaste/compraste/
 * cancelaste durante la prueba) se muestra aparte, con datos exactos, tal
 * cual estan en el log de transacciones replicado (systemStore.replica_tx).
 */
function computeBaselineProjection(flights, cfg) {
  const byClass = {
    FIRST: { sold: 0, reserved: 0, available: 0, revenue: 0 },
    ECONOMY: { sold: 0, reserved: 0, available: 0, revenue: 0 },
  };
  const byStatus = {};
  const byOwnerNode = {};

  for (const f of flights) {
    const model = aircraftConfig.models[f.aircraftModel];
    if (!model) continue;
    const soldFirst = model.firstClassSeats * cfg.soldPct;
    const resFirst = model.firstClassSeats * cfg.reservedPct;
    const soldEcon = model.economySeats * cfg.soldPct;
    const resEcon = model.economySeats * cfg.reservedPct;

    byClass.FIRST.sold += soldFirst;
    byClass.FIRST.reserved += resFirst;
    byClass.FIRST.available += model.firstClassSeats - soldFirst - resFirst;
    byClass.FIRST.revenue += soldFirst * (f.priceFirst || 0);

    byClass.ECONOMY.sold += soldEcon;
    byClass.ECONOMY.reserved += resEcon;
    byClass.ECONOMY.available += model.economySeats - soldEcon - resEcon;
    byClass.ECONOMY.revenue += soldEcon * (f.priceEconomy || 0);

    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    byOwnerNode[f.ownerNode] = (byOwnerNode[f.ownerNode] || 0) + 1;
  }

  for (const k of ['FIRST', 'ECONOMY']) {
    byClass[k].sold = Math.round(byClass[k].sold);
    byClass[k].reserved = Math.round(byClass[k].reserved);
    byClass[k].available = Math.round(byClass[k].available);
    byClass[k].revenue = Math.round(byClass[k].revenue);
  }

  return { byClass, byStatus, byOwnerNode, totalFlights: flights.length };
}

function computeLiveActivity(ctx) {
  const { systemStore, nodeId } = ctx;
  const agg = systemStore.globalAggregates(); // [{cabin_class, status, cnt, revenue}]
  const byClass = { FIRST: { sold: 0, reserved: 0, revenue: 0 }, ECONOMY: { sold: 0, reserved: 0, revenue: 0 } };
  for (const row of agg) {
    const bucket = byClass[row.cabin_class];
    if (!bucket) continue;
    if (row.status === 'SOLD') { bucket.sold += row.cnt; bucket.revenue += row.revenue || 0; }
    if (row.status === 'RESERVED') { bucket.reserved += row.cnt; }
  }
  const recentEvents = systemStore.recentEvents(30);
  const pendingOutbox = systemStore.listAllPendingOutbox();
  const faultState = ctx.faultService.state();

  return { byClass, recentEvents, pendingOutboxCount: pendingOutbox.length, pendingOutbox, faultState, nodeId };
}

function computeFlightDashboard(ctx, flightId) {
  const { flight, seats, stats } = ctx.bookingService.liveSeatMap(flightId);
  const liveTxCount = seats.filter((s) => s.source === 'LIVE').length;
  return { flight, stats, liveTxCount, seatCount: seats.length };
}

module.exports = { computeBaselineProjection, computeLiveActivity, computeFlightDashboard };
