'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const airports = require('../shared/airports');
const pricing = require('../shared/pricing');
const { getModelKeyForAircraftId } = require('../shared/seatMap');
const { newFlightId } = require('../shared/idgen');
const { createAdapter } = require('../server/db/adapterFactory');
const nodesConfig = require('../config/nodes.json').nodes;

const CSV_PATH = path.join(__dirname, '..', 'data', 'flights_dataset_actualizado.csv');
const REPORT_PATH = path.join(__dirname, '..', 'data', 'data_quality_report.json');

// "Hoy" para efectos de la simulacion. Coincide con la fecha minima real del
// dataset para que la regla "fecha futura => SCHEDULED" tenga sentido.
const SIM_TODAY = process.env.SIM_TODAY || '2026-09-26';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { driver: null, node: null };
  for (const a of args) {
    const driver = a.match(/^--driver=(.+)$/);
    const node = a.match(/^--node=(.+)$/);
    if (driver) out.driver = driver[1];
    if (node) out.node = node[1];
  }
  return out;
}

/** "09/30/26" -> "2026-09-30" (asume siglo 20xx). */
function toIsoDate(mmddyy) {
  const [mm, dd, yy] = mmddyy.split('/');
  return `20${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function normalizeTime(hhmm) {
  const [h, m] = hhmm.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function parseCsv(raw) {
  const lines = raw.split(/\r\n|\n/).filter((l) => l.length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',').map((s) => s.trim());
    if (c.length < 7) continue;
    rows.push({
      flightDate: c[0],
      flightTime: c[1],
      origin: c[2],
      destination: c[3],
      aircraftId: c[4],
      status: c[5],
      gate: c[6],
    });
  }
  return rows;
}

function checkAircraftContinuity(flights) {
  const byAircraft = new Map();
  for (const f of flights) {
    if (!byAircraft.has(f.aircraftId)) byAircraft.set(f.aircraftId, []);
    byAircraft.get(f.aircraftId).push(f);
  }
  const anomalies = [];
  for (const [aircraftId, list] of byAircraft) {
    list.sort((a, b) => (a.flightDate + a.flightTime).localeCompare(b.flightDate + b.flightTime));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (prev.destination !== cur.origin) {
        anomalies.push({
          aircraftId,
          prevFlight: { id: prev.id, date: prev.flightDate, time: prev.flightTime, dest: prev.destination },
          nextFlight: { id: cur.id, date: cur.flightDate, time: cur.flightTime, origin: cur.origin },
        });
      }
    }
  }
  return anomalies;
}

async function main() {
  const { driver: driverOverride, node: selectedNode } = parseArgs();
  if (selectedNode && !nodesConfig[selectedNode]) {
    throw new Error(`Nodo invalido: ${selectedNode}. Usa uno de: ${Object.keys(nodesConfig).join(', ')}`);
  }
  console.log(`\n=== Seed de Aerolineas Rafael Pabon ===`);
  console.log(`Hoy (simulado): ${SIM_TODAY}`);
  console.log(`Driver override: ${driverOverride || '(usar el de config/nodes.json por nodo)'}\n`);
  console.log(`Destino: ${selectedNode || 'los 3 nodos'}\n`);

  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rawRows = parseCsv(raw);
  console.log(`Filas leidas del CSV: ${rawRows.length}`);

  let forcedScheduledCount = 0;
  let priceEstimatedCount = 0;
  const estimatedPairs = new Set();

  const flights = rawRows.map((r, idx) => {
    const id = newFlightId(idx + 1);
    const flightDate = toIsoDate(r.flightDate);
    const flightTime = normalizeTime(r.flightTime);

    // Regla: todo vuelo con fecha posterior a "hoy" debe quedar SCHEDULED.
    let status = r.status;
    if (flightDate > SIM_TODAY && status !== 'SCHEDULED') {
      status = 'SCHEDULED';
      forcedScheduledCount++;
    }

    const aircraftModel = getModelKeyForAircraftId(r.aircraftId);
    const ownerNode = airports.ownerNodeForFlight(r.origin, r.destination);

    const econ = pricing.getPriceOrEstimate(r.origin, r.destination, 'ECONOMY');
    const first = pricing.getPriceOrEstimate(r.origin, r.destination, 'FIRST');
    if (econ.estimated) { priceEstimatedCount++; estimatedPairs.add(`${r.origin}->${r.destination}`); }

    return {
      id,
      flightDate,
      flightTime,
      origin: r.origin,
      destination: r.destination,
      aircraftId: Number(r.aircraftId),
      aircraftModel,
      status,
      gate: r.gate || null,
      ownerNode,
      priceEconomy: econ.value,
      priceFirst: first.value,
      priceEstimated: econ.estimated,
      timeHours: pricing.getTime(r.origin, r.destination),
      updatedAt: null,
    };
  });

  console.log(`Vuelos futuros forzados a SCHEDULED: ${forcedScheduledCount}`);
  console.log(`Vuelos con precio estimado via Dijkstra (sin ruta directa en la matriz): ${priceEstimatedCount} (${estimatedPairs.size} pares distintos)`);

  console.log('Verificando continuidad de aeronaves (que no "teletransporten")...');
  const anomalies = checkAircraftContinuity(flights);
  console.log(`Anomalias de continuidad detectadas: ${anomalies.length}`);

  const ownerCounts = flights.reduce((acc, f) => {
    acc[f.ownerNode] = (acc[f.ownerNode] || 0) + 1;
    return acc;
  }, {});
  console.log('Distribucion de vuelos por nodo dueno (segun aeropuerto DESTINO):', ownerCounts);

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        simToday: SIM_TODAY,
        totalFlights: flights.length,
        forcedScheduledCount,
        priceEstimatedCount,
        estimatedPairs: Array.from(estimatedPairs),
        aircraftContinuityAnomalies: anomalies.length,
        aircraftContinuitySample: anomalies.slice(0, 20),
        ownerNodeDistribution: ownerCounts,
      },
      null,
      2
    )
  );
  console.log(`Reporte de calidad de datos escrito en ${REPORT_PATH}`);

  // En LAN se recomienda ejecutar --node=NODE_XX en cada computadora para
  // poblar solo su base local. Sin --node conserva el modo centralizado.
  const targetNodes = selectedNode ? [selectedNode] : Object.keys(nodesConfig);
  for (const nodeId of targetNodes) {
    const driver = driverOverride || nodesConfig[nodeId].dbDriver;
    console.log(`\n-> Cargando ${flights.length} vuelos en ${nodeId} (driver=${driver})...`);
    const adapter = createAdapter(nodeId, driver);
    await adapter.init();
    await adapter.bulkInsertFlights(flights);
    console.log(`   OK: ${nodeId} listo.`);
    await adapter.close();
  }

  console.log('\nSeed completo. Ya puedes levantar los nodos (ver README.md).');
}

main().catch((err) => {
  console.error('Error en el seed:', err);
  process.exit(1);
});
