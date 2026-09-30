'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { guard, validateSecurity } = require('./middleware/auth');
const { recoverDecisions } = require('./services/syncCore');

const nodesConfig = require('../config/nodes.json').nodes;
const { createAdapter } = require('./db/adapterFactory');
const { SystemStore } = require('./db/systemStore');
const { ClockService } = require('./services/clockService');
const { FaultService } = require('./services/faultService');
const { ConfigService } = require('./services/configService');
const { FlightCache } = require('./services/flightCache');
const { BookingService } = require('./services/bookingService');
const { SagaService, startSagaWorker } = require('./services/sagaService');
const { ConnectionTracker } = require('./services/connectionTracker');
const { partitionGuard } = require('./middleware/partitionGuard');
const { startOutboxWorker } = require('./sync/outboxWorker');
const { startRefundWorker } = require('./sync/refundWorker');

const { buildFlightsRouter } = require('./routes/flights');
const { buildBookingRouter } = require('./routes/booking');
const { buildItineraryRouter } = require('./routes/itinerary');
const { buildReportsRouter } = require('./routes/reports');
const { buildRoutePlannerRouter } = require('./routes/routePlanner');
const { buildAdminRouter } = require('./routes/admin');
const { buildWalletRouter } = require('./routes/wallet');
const { buildSyncRouter } = require('./routes/sync');

const NODE_ID = process.env.NODE_ID;
if (!NODE_ID || !nodesConfig[NODE_ID]) {
  console.error(`NODE_ID invalido o no definido. Usa uno de: ${Object.keys(nodesConfig).join(', ')}`);
  console.error('Ejemplo: NODE_ID=NODE_NA PORT=4001 node server/index.js');
  process.exit(1);
}
const PORT = Number(process.env.PORT || nodesConfig[NODE_ID].port);

/** Regla del enunciado: al iniciar, ningun vuelo con fecha futura deberia
 *  tener un estado distinto de SCHEDULED (se corrige antes de servir trafico). */
async function enforceScheduledRule(ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const toFix = ctx.flightCache.all().filter((f) => f.date > today && f.status !== 'SCHEDULED');
  if (toFix.length === 0) return 0;
  await ctx.primaryAdapter.bulkUpdateStatuses(toFix.map((f) => [f.id, 'SCHEDULED']));
  await ctx.flightCache.load();
  return toFix.length;
}

async function main() {
  validateSecurity();
  console.log(`\n=== Iniciando ${NODE_ID} (${nodesConfig[NODE_ID].label}) en puerto ${PORT} ===`);

  const systemStore = new SystemStore(NODE_ID);
  // Sin DB_DRIVER en el entorno, se usa el motor "de verdad" configurado en
  // config/nodes.json (mssql/mongo). Para el modo local de 1 PC sin
  // instalar nada, exporta DB_DRIVER=sqlite antes de levantar el nodo.
  const primaryAdapter = createAdapter(NODE_ID, process.env.DB_DRIVER || nodesConfig[NODE_ID].dbDriver);
  await primaryAdapter.init();
  console.log(`[${NODE_ID}] Base de datos primaria conectada: ${primaryAdapter.kind}`);

  const flightCache = new FlightCache(primaryAdapter);
  console.log(`[${NODE_ID}] Cargando vuelos desde la base primaria...`);
  const loaded = await flightCache.load();
  console.log(`[${NODE_ID}] Vuelos cargados en cache: ${loaded}`);

  const ctx = {
    nodeId: NODE_ID,
    systemStore,
    primaryAdapter,
    flightCache,
  };
  ctx.clockService = new ClockService(NODE_ID, systemStore);
  ctx.faultService = new FaultService(systemStore);
  ctx.configService = new ConfigService(systemStore);
  ctx.bookingService = new BookingService(ctx);
  ctx.sagaService = new SagaService(ctx);
  ctx.connectionTracker = new ConnectionTracker(systemStore);
  await recoverDecisions(ctx);
  for (const tx of await primaryAdapter.getAllOwnedTransactions()) systemStore.upsertReplicaTx(tx);

  const fixed = await enforceScheduledRule(ctx);
  if (fixed > 0) console.log(`[${NODE_ID}] Se corrigieron ${fixed} vuelos futuros a estado SCHEDULED.`);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (req, res) => {
    res.json({
      nodeId: NODE_ID,
      status: 'ok',
      dbDriver: primaryAdapter.kind,
      faultState: ctx.faultService.state(),
      flightsLoaded: flightCache.byId.size,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  // El frontend descubre las URLs de los 3 nodos aqui (sirve tanto para 1 PC como para LAN:
  // usa los mismos hosts que este nodo usa para hablar con sus pares).
  app.get('/api/network', (req, res) => {
    const { baseUrlFor } = require('./sync/replicationClient');
    res.json({
      self: NODE_ID,
      nodes: Object.entries(nodesConfig).map(([id, n]) => ({
        id,
        label: n.label,
        flag: n.flagEmoji,
        dbDriver: n.dbDriver,
        url: baseUrlFor(id),
      })),
    });
  });

  app.use('/internal/sync', guard('sync'), partitionGuard(ctx), buildSyncRouter(ctx));

  // Cada peticion de un cliente a la API cuenta para el reporte de conexiones (la sincronizacion entre nodos no).
  app.use('/api', ctx.connectionTracker.middleware());
  app.use('/api', buildFlightsRouter(ctx));
  app.use('/api', buildBookingRouter(ctx));
  app.use('/api', buildItineraryRouter(ctx));
  app.use('/api', buildReportsRouter(ctx));
  app.use('/api', buildRoutePlannerRouter(ctx));
  app.use('/api/admin', (req, res, next) => {
    // Public dashboards remain readable; administrative data and writes require a key.
    if (req.method === 'GET' && (req.path.startsWith('/dashboard/') || req.path === '/status')) return next();
    return guard('admin')(req, res, next);
  }, buildAdminRouter(ctx));
  app.use('/api', buildWalletRouter(ctx));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/internal')) return next();
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  startOutboxWorker(ctx);
  startRefundWorker(ctx);
  startSagaWorker(ctx);
  ctx.connectionTracker.start();

  app.listen(PORT, process.env.BIND_HOST || '0.0.0.0', () => {
    console.log(`[${NODE_ID}] Escuchando en http://${process.env.BIND_HOST || '0.0.0.0'}:${PORT}  (dueno de region: ${nodesConfig[NODE_ID].ownsRegion})`);
    console.log(`[${NODE_ID}] Interfaz web: http://localhost:${PORT}\n`);
  });
}

main().catch((err) => {
  console.error('Error fatal al iniciar el nodo:', err);
  process.exit(1);
});
