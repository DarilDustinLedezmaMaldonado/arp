'use strict';

const fs = require('fs');
const path = require('path');
const { rngFromSeedString } = require('./seededRandom');
const { randomPassengerName } = require('./names');

const aircraftConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'aircraft.json'), 'utf-8')
);

/**
 * NOTA DE DISENO IMPORTANTE (ver docs/ARQUITECTURA.md):
 * Con 60,000 vuelos y hasta 449 asientos por avion, materializar y guardar
 * en base de datos cada asiento de cada vuelo implicaria ~15-20 millones de
 * filas que NADIE va a consultar durante la demo, solo para cumplir el
 * "73% vendido / 3% reservado" del enunciado. En vez de eso, el estado BASE
 * de ocupacion de un vuelo se genera de forma DETERMINISTICA (pseudo-aleatoria
 * con semilla = flightId) en el momento en que se consulta: siempre da el
 * mismo resultado, en cualquier nodo, sin necesidad de guardarlo. Lo unico
 * que SI se persiste (y por lo tanto lo unico que hay que sincronizar entre
 * nodos con relojes de Lamport/vectoriales) son las transacciones REALES que
 * ocurren durante la demo (reservar/comprar/cancelar un asiento especifico),
 * que se guardan como "overlay" y siempre tienen prioridad sobre la base.
 */

function getModelKeyForAircraftId(aircraftId) {
  const id = Number(aircraftId);
  for (const [key, model] of Object.entries(aircraftConfig.models)) {
    if (id >= model.idRange[0] && id <= model.idRange[1]) return key;
  }
  return 'B777';
}

function buildSeatNumbers(count, cols, startRow) {
  const seats = [];
  let row = startRow;
  while (seats.length < count) {
    for (const col of cols) {
      if (seats.length >= count) break;
      seats.push(`${row}${col}`);
    }
    row++;
  }
  return seats;
}

const _layoutCache = {};
function getSeatLayout(modelKey) {
  if (_layoutCache[modelKey]) return _layoutCache[modelKey];
  const model = aircraftConfig.models[modelKey];
  const layout = aircraftConfig.seatLayout[modelKey];
  const firstRowsCount = Math.ceil(model.firstClassSeats / layout.firstCols.length);
  const firstSeats = buildSeatNumbers(model.firstClassSeats, layout.firstCols, 1);
  const economySeats = buildSeatNumbers(model.economySeats, layout.economyCols, firstRowsCount + 2);
  const result = { firstSeats, economySeats, model };
  _layoutCache[modelKey] = result;
  return result;
}

/**
 * Genera el mapa de asientos BASE (deterministico) de un vuelo.
 * @param {string} flightId
 * @param {string} modelKey
 * @param {{soldPct:number, reservedPct:number}} distribution config (73%/3% por defecto)
 * @param {{economy:number, first:number}} prices precio a asignar a los asientos vendidos/reservados
 */
function generateBaseSeatMap(flightId, modelKey, distribution, prices) {
  const { firstSeats, economySeats } = getSeatLayout(modelKey);
  const rng = rngFromSeedString(`${flightId}::seatmap::v1`);
  const soldPct = distribution.soldPct;
  const reservedPct = distribution.soldPct + distribution.reservedPct;

  function buildFor(seatNumbers, cabinClass, price) {
    return seatNumbers.map((seatNumber) => {
      const r = rng();
      let status = 'AVAILABLE';
      let passengerName = null;
      if (r < soldPct) {
        status = 'SOLD';
        passengerName = randomPassengerName(rng);
      } else if (r < reservedPct) {
        status = 'RESERVED';
        passengerName = randomPassengerName(rng);
      } else {
        rng(); // consumir igual para que la secuencia no dependa de la rama tomada
      }
      return {
        seatNumber,
        cabinClass,
        status,
        passengerName,
        price: status === 'AVAILABLE' ? price : price,
        source: 'BASE',
      };
    });
  }

  const firstSeatsState = buildFor(firstSeats, 'FIRST', prices.first);
  const economySeatsState = buildFor(economySeats, 'ECONOMY', prices.economy);
  return [...firstSeatsState, ...economySeatsState];
}

/**
 * Combina el mapa base deterministico con las transacciones reales
 * persistidas (overlay). Las transacciones reales SIEMPRE ganan.
 */
function applyOverlay(baseSeats, transactions) {
  const bySeat = new Map(baseSeats.map((s) => [s.seatNumber, { ...s }]));
  // Se procesan en orden de lamportTs para que "la ultima transaccion valida gane"
  const sorted = [...transactions].sort((a, b) => a.lamportTs - b.lamportTs);
  for (const tx of sorted) {
    if (tx.syncStatus !== 'SYNCED' || ['CONFLICT_LOST', 'REJECTED', 'PENDING'].includes(tx.status)) continue;
    const existing = bySeat.get(tx.seatNumber);
    if (!existing) continue;
    bySeat.set(tx.seatNumber, {
      seatNumber: tx.seatNumber,
      cabinClass: tx.cabinClass,
      status: tx.status,
      passengerName: tx.passengerName,
      passengerEmail: tx.passengerEmail,
      pnr: tx.pnr,
      price: tx.price,
      source: 'LIVE',
      txId: tx.id,
      originNode: tx.originNode,
      syncStatus: tx.syncStatus,
      lamportTs: tx.lamportTs,
    });
  }
  return Array.from(bySeat.values());
}

function aggregateStats(seats) {
  const stats = {
    FIRST: { sold: 0, reserved: 0, available: 0, revenue: 0 },
    ECONOMY: { sold: 0, reserved: 0, available: 0, revenue: 0 },
  };
  for (const s of seats) {
    const bucket = stats[s.cabinClass];
    if (!bucket) continue;
    if (s.status === 'SOLD') {
      bucket.sold += 1;
      bucket.revenue += s.price || 0;
    } else if (s.status === 'RESERVED') {
      bucket.reserved += 1;
    } else if (s.status === 'AVAILABLE' || s.status === 'REFUNDED') {
      bucket.available += 1;
    }
  }
  return stats;
}

module.exports = {
  getModelKeyForAircraftId,
  getSeatLayout,
  generateBaseSeatMap,
  applyOverlay,
  aggregateStats,
};
