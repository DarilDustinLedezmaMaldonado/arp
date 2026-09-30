'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { acceptsReplica } = require('../../shared/transactionState');

/**
 * Cada nodo tiene, ADEMAS de su base de datos primaria (SQL Server o
 * MongoDB), un almacen local SIEMPRE disponible (SQLite embebido, un simple
 * archivo en disco) que cumple 3 funciones:
 *
 *  1. OUTBOX: cola durable de eventos pendientes de entregar a otro nodo
 *     (patron "outbox pattern"). Si el nodo dueno de un vuelo esta caido o
 *     inalcanzable, la transaccion se guarda aqui y un job de fondo reintenta
 *     entregarla hasta que el dueno se recupera.
 *  2. REPLICA / CACHE DE LECTURA: copia de TODAS las transacciones reales del
 *     sistema (propias + recibidas por replicacion de los otros 2 nodos), lo
 *     que permite que el dashboard global y "ver en otros nodos si de verdad
 *     se compro" funcionen sin tener que hacer consultas cruzadas entre
 *     tecnologias de BD distintas (SQL Server <-> Mongo) en tiempo real.
 *  3. ESTADO DE FALLAS Y CONFIGURACION: flags de "simular caida" y valores
 *     configurables (73%/3%, delay de consistencia eventual, etc).
 *
 * Este almacen NO reemplaza ni compite con las 3 bases de datos exigidas por
 * la practica (2 SQL Server + 1 MongoDB) - ver docs/ARQUITECTURA.md.
 */
class SystemStore {
  constructor(nodeId, directory = process.env.ARP_DATA_DIR) {
    this.nodeId = nodeId;
    const dataDir = directory || path.join(__dirname, '..', '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, `system_${nodeId}.sqlite`));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this._migrate();
    this._seedDefaults();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY, flight_id TEXT NOT NULL, seat_number TEXT NOT NULL,
        payload_json TEXT NOT NULL, committed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        target_node TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        delivered INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT
      );

      CREATE TABLE IF NOT EXISTS replica_tx (
        id TEXT PRIMARY KEY,
        flight_id TEXT NOT NULL,
        seat_number TEXT NOT NULL,
        cabin_class TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL,
        passenger_name TEXT,
        passenger_email TEXT,
        pnr TEXT,
        based_on_tx_id TEXT,
        price REAL,
        origin_node TEXT NOT NULL,
        owner_node TEXT NOT NULL,
        lamport_ts INTEGER NOT NULL,
        vector_clock_json TEXT NOT NULL,
        sync_status TEXT NOT NULL,
        conflict_reason TEXT,
        refund_available_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        origin_node TEXT NOT NULL,
        lamport_ts INTEGER NOT NULL,
        vector_clock_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fault_state (
        node_id TEXT PRIMARY KEY,
        db_down INTEGER NOT NULL DEFAULT 0,
        network_partitioned INTEGER NOT NULL DEFAULT 0,
        since_when TEXT
      );

      CREATE TABLE IF NOT EXISTS config_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT,
        lamport_ts INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS clocks (
        node_id TEXT PRIMARY KEY,
        lamport INTEGER NOT NULL DEFAULT 0,
        vector_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sagas (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_replica_flight ON replica_tx(flight_id);
      CREATE INDEX IF NOT EXISTS idx_sagas_status ON sagas(status);

      CREATE TABLE IF NOT EXISTS client_sessions (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        ip TEXT,
        started_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        purchase_requests INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_client_sessions_client ON client_sessions(client_id);
      CREATE INDEX IF NOT EXISTS idx_outbox_target ON outbox(target_node, delivered);
    `);
  }

  _seedDefaults() {
    const exists = this.db.prepare('SELECT 1 FROM fault_state WHERE node_id = ?').get(this.nodeId);
    if (!exists) {
      this.db.prepare('INSERT INTO fault_state (node_id, db_down, network_partitioned) VALUES (?, 0, 0)').run(this.nodeId);
    }
    const defaults = {
      soldPct: '0.73',
      reservedPct: '0.03',
      refundDelaySeconds: '900',
      currentSimulatedCountryNode: this.nodeId,
    };
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO config_kv (key, value, updated_at, lamport_ts) VALUES (?, ?, ?, 0)'
    );
    for (const [k, v] of Object.entries(defaults)) insert.run(k, v, new Date().toISOString());

    const clockExists = this.db.prepare('SELECT 1 FROM clocks WHERE node_id = ?').get(this.nodeId);
    if (!clockExists) {
      this.db
        .prepare('INSERT INTO clocks (node_id, lamport, vector_json) VALUES (?, 0, ?)')
        .run(this.nodeId, JSON.stringify({ NODE_NA: 0, NODE_EA: 0, NODE_SA: 0 }));
    }
  }

  // ---------- Outbox ----------
  enqueueOutbox({ id, targetNode, eventType, payload }) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO outbox (id, target_node, event_type, payload_json, created_at, attempts, delivered) VALUES (?, ?, ?, ?, ?, 0, 0)'
      )
      .run(id, targetNode, eventType, JSON.stringify(payload), new Date().toISOString());
  }

  listPendingOutbox(targetNode) {
    return this.db
      .prepare('SELECT * FROM outbox WHERE target_node = ? AND delivered = 0 ORDER BY created_at ASC')
      .all(targetNode)
      .map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  }

  listAllPendingOutbox() {
    return this.db
      .prepare('SELECT * FROM outbox WHERE delivered = 0 ORDER BY created_at ASC')
      .all()
      .map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));
  }

  markOutboxDelivered(id) {
    this.db.prepare('UPDATE outbox SET delivered = 1 WHERE id = ?').run(id);
  }

  bumpOutboxAttempt(id) {
    this.db
      .prepare('UPDATE outbox SET attempts = attempts + 1, last_attempt_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  // ---------- Replica / cache de lectura (todas las tx del sistema) ----------
  upsertReplicaTx(tx) {
    if (!acceptsReplica(this.getReplicaTxById(tx.id), tx)) return;
    this.db
      .prepare(
        `INSERT INTO replica_tx (id, flight_id, seat_number, cabin_class, action_type, status, passenger_name, passenger_email, pnr, based_on_tx_id, price, origin_node, owner_node, lamport_ts, vector_clock_json, sync_status, conflict_reason, refund_available_at, created_at)
         VALUES (@id,@flightId,@seatNumber,@cabinClass,@actionType,@status,@passengerName,@passengerEmail,@pnr,@basedOnTxId,@price,@originNode,@ownerNode,@lamportTs,@vectorClockJson,@syncStatus,@conflictReason,@refundAvailableAt,@createdAt)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, sync_status=excluded.sync_status, conflict_reason=excluded.conflict_reason, refund_available_at=excluded.refund_available_at, lamport_ts=excluded.lamport_ts, vector_clock_json=excluded.vector_clock_json`
      )
      .run({
        id: tx.id,
        flightId: tx.flightId,
        seatNumber: tx.seatNumber,
        cabinClass: tx.cabinClass,
        actionType: tx.actionType,
        status: tx.status,
        passengerName: tx.passengerName || null,
        passengerEmail: tx.passengerEmail || null,
        pnr: tx.pnr || null,
        basedOnTxId: tx.basedOnTxId || null,
        price: tx.price || null,
        originNode: tx.originNode,
        ownerNode: tx.ownerNode,
        lamportTs: tx.lamportTs,
        vectorClockJson: JSON.stringify(tx.vectorClock),
        syncStatus: tx.syncStatus,
        conflictReason: tx.conflictReason || null,
        refundAvailableAt: tx.refundAvailableAt || null,
        createdAt: tx.createdAt,
      });
  }

  getReplicaTxForFlight(flightId) {
    return this.db
      .prepare('SELECT * FROM replica_tx WHERE flight_id = ? ORDER BY lamport_ts ASC')
      .all(flightId)
      .map(rowToTx);
  }

  getReplicaTxById(id) {
    const row = this.db.prepare('SELECT * FROM replica_tx WHERE id = ?').get(id);
    return row ? rowToTx(row) : null;
  }

  /** Pasajes recientes (compras y/o reservas) que este nodo conoce, propios o replicados. */
  recentTickets({ type = 'PURCHASE', q = '', limit = 30 } = {}) {
    const types = type === 'ALL' ? ['PURCHASE', 'RESERVE'] : [type];
    const like = `%${String(q).trim()}%`;
    return this.db
      .prepare(`SELECT * FROM replica_tx WHERE action_type IN (${types.map(() => '?').join(',')})
        AND (? = '%%' OR passenger_name LIKE ? OR pnr LIKE ? OR flight_id LIKE ? OR id LIKE ?)
        ORDER BY created_at DESC LIMIT ?`)
      .all(...types, like, like, like, like, like, limit)
      .map(rowToTx);
  }

  /** Estado con que este nodo conoce cada transaccion (null si aun no le llego). */
  replicaStatusByIds(ids) {
    if (!ids.length) return {};
    const rows = this.db.prepare(`SELECT id, status, sync_status FROM replica_tx WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const out = Object.fromEntries(ids.map((id) => [id, null]));
    for (const r of rows) out[r.id] = { status: r.status, syncStatus: r.sync_status };
    return out;
  }

  prepareDecision(tx) {
    this.db.prepare('INSERT OR IGNORE INTO decisions (id, flight_id, seat_number, payload_json) VALUES (?, ?, ?, ?)')
      .run(tx.id, tx.flightId, tx.seatNumber, JSON.stringify(tx));
  }

  preparedDecisions() {
    return this.db.prepare('SELECT payload_json FROM decisions WHERE committed=0 ORDER BY rowid')
      .all().map((r) => JSON.parse(r.payload_json));
  }

  commitDecision(tx, targets) {
    this.db.transaction(() => {
      this.upsertReplicaTx(tx);
      for (const targetNode of targets) this.enqueueOutbox({
        id: `DECISION-${tx.id}-${targetNode}`, targetNode, eventType: 'CACHE_MIRROR',
        payload: { kind: 'CACHE_MIRROR', event: tx },
      });
      this.db.prepare('UPDATE decisions SET committed=1 WHERE id=?').run(tx.id);
    })();
  }

  savePending(tx) {
    this.db.transaction(() => {
      this.upsertReplicaTx(tx);
      this.enqueueOutbox({ id: `REQUEST-${tx.id}`, targetNode: tx.ownerNode,
        eventType: 'SEAT_TX_REQUEST', payload: { kind: 'SEAT_TX_REQUEST', event: tx } });
    })();
  }

  // ---------- Conexiones de clientes (reporte de conexiones por servidor) ----------
  saveClientSession(s) {
    this.db
      .prepare(`INSERT INTO client_sessions (id, client_id, ip, started_at, last_seen, requests, purchase_requests)
         VALUES (@id, @clientId, @ip, @startedAt, @lastSeen, @requests, @purchaseRequests)
         ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen, requests=excluded.requests, purchase_requests=excluded.purchase_requests`)
      .run(s);
  }

  connectionStats(nowMs = Date.now(), activeWindowMs = 5 * 60 * 1000) {
    const row = this.db.prepare(`SELECT
        COUNT(*) AS connections,
        COUNT(DISTINCT client_id) AS clients,
        COALESCE(SUM(requests), 0) AS requests,
        COALESCE(SUM(CASE WHEN purchase_requests > 0 THEN 1 ELSE 0 END), 0) AS purchaseConnections,
        COALESCE(SUM(purchase_requests), 0) AS purchaseRequests,
        COALESCE(SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS activeNow,
        MIN(started_at) AS since
      FROM client_sessions`).get(nowMs - activeWindowMs);
    const tickets = this.db.prepare(`SELECT COUNT(*) AS n FROM replica_tx
      WHERE origin_node = ? AND action_type = 'PURCHASE' AND status = 'SOLD' AND sync_status = 'SYNCED'`).get(this.nodeId).n;
    return { ...row, ticketsSoldHere: tickets };
  }

  /** Vuelos con compras o reservas reales, los mas recientes primero (atajos para la lista de embarque). */
  flightsWithLiveTickets(limit = 8) {
    return this.db.prepare(`SELECT flight_id AS flightId, COUNT(*) AS tickets, MAX(created_at) AS lastAt FROM replica_tx
      WHERE action_type IN ('PURCHASE','RESERVE','CHECKIN') AND status IN ('SOLD','RESERVED','CHECKED_IN') AND sync_status = 'SYNCED'
      GROUP BY flight_id ORDER BY lastAt DESC LIMIT ?`).all(limit);
  }

  // ---------- Sagas de compra combinada (el estado del orquestador es durable) ----------
  saveSaga(saga) {
    this.db
      .prepare(`INSERT INTO sagas (id, status, payload_json, created_at, updated_at) VALUES (@id, @status, @json, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload_json=excluded.payload_json, updated_at=excluded.updated_at`)
      .run({ id: saga.id, status: saga.status, json: JSON.stringify(saga), createdAt: saga.createdAt, updatedAt: saga.updatedAt });
  }

  getSaga(id) {
    const row = this.db.prepare('SELECT payload_json FROM sagas WHERE id = ?').get(id);
    return row ? JSON.parse(row.payload_json) : null;
  }

  listActiveSagas() {
    return this.db
      .prepare("SELECT payload_json FROM sagas WHERE status IN ('RESERVING','PURCHASING','COMPENSATING') ORDER BY created_at")
      .all().map((r) => JSON.parse(r.payload_json));
  }

  recentSagas(limit = 20) {
    return this.db.prepare('SELECT payload_json FROM sagas ORDER BY created_at DESC LIMIT ?')
      .all(limit).map((r) => JSON.parse(r.payload_json));
  }

  listDueRefunds(nowIso) {
    return this.db
      .prepare("SELECT * FROM replica_tx WHERE status = 'REFUNDED' AND refund_available_at IS NOT NULL AND refund_available_at <= ?")
      .all(nowIso)
      .map(rowToTx);
  }

  globalAggregates() {
    const rows = this.db
      .prepare(
        `WITH effective AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY flight_id,seat_number ORDER BY lamport_ts DESC,id DESC) AS rn
          FROM replica_tx WHERE sync_status='SYNCED' AND status NOT IN ('CONFLICT_LOST','REJECTED','PENDING')
        ) SELECT cabin_class,status,COUNT(*) AS cnt,SUM(price) AS revenue FROM effective
          WHERE rn=1 AND status IN ('SOLD','RESERVED') GROUP BY cabin_class,status`
      )
      .all();
    return rows;
  }

  recentEvents(limit = 50) {
    return this.db
      .prepare('SELECT * FROM event_log ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map((r) => ({ ...r, vectorClock: JSON.parse(r.vector_clock_json) }));
  }

  appendEvent({ id, eventType, summary, originNode, lamportTs, vectorClock }) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO event_log (id, event_type, summary, origin_node, lamport_ts, vector_clock_json, created_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run(id, eventType, summary, originNode, lamportTs, JSON.stringify(vectorClock), new Date().toISOString());
  }

  // ---------- Fault injection ----------
  getFaultState() {
    const row = this.db.prepare('SELECT * FROM fault_state WHERE node_id = ?').get(this.nodeId);
    return { dbDown: !!row.db_down, networkPartitioned: !!row.network_partitioned };
  }

  setFaultState({ dbDown, networkPartitioned }) {
    const current = this.getFaultState();
    const next = {
      dbDown: dbDown === undefined ? current.dbDown : dbDown,
      networkPartitioned: networkPartitioned === undefined ? current.networkPartitioned : networkPartitioned,
    };
    this.db
      .prepare('UPDATE fault_state SET db_down = ?, network_partitioned = ?, since_when = ? WHERE node_id = ?')
      .run(next.dbDown ? 1 : 0, next.networkPartitioned ? 1 : 0, new Date().toISOString(), this.nodeId);
    return next;
  }

  // ---------- Config ----------
  getConfig(key) {
    const row = this.db.prepare('SELECT value FROM config_kv WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  getAllConfig() {
    const rows = this.db.prepare('SELECT key, value FROM config_kv').all();
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  setConfig(key, value, lamportTs) {
    this.db
      .prepare(
        `INSERT INTO config_kv (key, value, updated_at, lamport_ts) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, lamport_ts = excluded.lamport_ts
         WHERE excluded.lamport_ts >= config_kv.lamport_ts`
      )
      .run(key, String(value), new Date().toISOString(), lamportTs || 0);
  }

  // ---------- Clocks persistidos (para sobrevivir reinicios del proceso) ----------
  loadClocks() {
    const row = this.db.prepare('SELECT * FROM clocks WHERE node_id = ?').get(this.nodeId);
    return { lamport: row.lamport, vector: JSON.parse(row.vector_json) };
  }

  saveClocks(lamport, vector) {
    this.db
      .prepare('UPDATE clocks SET lamport = ?, vector_json = ? WHERE node_id = ?')
      .run(lamport, JSON.stringify(vector), this.nodeId);
  }
}

function rowToTx(row) {
  return {
    id: row.id,
    flightId: row.flight_id,
    seatNumber: row.seat_number,
    cabinClass: row.cabin_class,
    actionType: row.action_type,
    status: row.status,
    passengerName: row.passenger_name,
    passengerEmail: row.passenger_email,
    pnr: row.pnr,
    basedOnTxId: row.based_on_tx_id,
    price: row.price,
    originNode: row.origin_node,
    ownerNode: row.owner_node,
    lamportTs: row.lamport_ts,
    vectorClock: JSON.parse(row.vector_clock_json),
    syncStatus: row.sync_status,
    conflictReason: row.conflict_reason,
    refundAvailableAt: row.refund_available_at,
    createdAt: row.created_at,
  };
}

module.exports = { SystemStore };
