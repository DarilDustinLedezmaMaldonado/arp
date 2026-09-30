'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Adaptador SQLite. Se usa como base de datos primaria por defecto para
 * poder levantar y probar el sistema completo en 1 sola PC sin instalar SQL
 * Server ni MongoDB (ver README "Modo LOCAL / 1 PC"). Implementa EXACTAMENTE
 * la misma interfaz que mssqlAdapter.js y mongoAdapter.js, que son los que se
 * usan de verdad en la entrega final sobre 3 PCs (DB_DRIVER=mssql|mongo en
 * .env). Cambiar de motor es solo cuestion de configuracion, no de codigo.
 */
class SqliteAdapter {
  constructor(nodeId, directory = process.env.ARP_DATA_DIR) {
    this.nodeId = nodeId;
    this.directory = directory;
    this.kind = 'sqlite';
  }

  async init() {
    const dataDir = this.directory || path.join(__dirname, '..', '..', '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, `primary_${this.nodeId}.sqlite`));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS flights (
        id TEXT PRIMARY KEY,
        flight_date TEXT NOT NULL,
        flight_time TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        aircraft_id INTEGER NOT NULL,
        aircraft_model TEXT NOT NULL,
        status TEXT NOT NULL,
        gate TEXT,
        owner_node TEXT NOT NULL,
        price_economy REAL,
        price_first REAL,
        time_hours REAL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_flights_od ON flights(origin, destination);
      CREATE INDEX IF NOT EXISTS idx_flights_owner ON flights(owner_node);
      CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(flight_date);

      CREATE TABLE IF NOT EXISTS seat_transactions (
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
      CREATE INDEX IF NOT EXISTS idx_tx_flight ON seat_transactions(flight_id);
    `);
  }

  async bulkInsertFlights(flights) {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO flights (id, flight_date, flight_time, origin, destination, aircraft_id, aircraft_model, status, gate, owner_node, price_economy, price_first, time_hours, updated_at)
       VALUES (@id,@flightDate,@flightTime,@origin,@destination,@aircraftId,@aircraftModel,@status,@gate,@ownerNode,@priceEconomy,@priceFirst,@timeHours,@updatedAt)`
    );
    const tx = this.db.transaction((rows) => {
      for (const f of rows) insert.run(f);
    });
    tx(flights);
  }

  async getFlight(id) {
    const row = this.db.prepare('SELECT * FROM flights WHERE id = ?').get(id);
    return row ? flightRowToObj(row) : null;
  }

  async listFlights({ origin, destination, dateFrom, dateTo, ownerNode, status, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM flights WHERE 1=1';
    const params = [];
    if (origin) { sql += ' AND origin = ?'; params.push(origin); }
    if (destination) { sql += ' AND destination = ?'; params.push(destination); }
    if (dateFrom) { sql += ' AND flight_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND flight_date <= ?'; params.push(dateTo); }
    if (ownerNode) { sql += ' AND owner_node = ?'; params.push(ownerNode); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY flight_date ASC, flight_time ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return this.db.prepare(sql).all(...params).map(flightRowToObj);
  }

  async countFlights(filters = {}) {
    const rows = await this.listFlights({ ...filters, limit: 1000000, offset: 0 });
    return rows.length;
  }

  async updateFlightStatus(id, status) {
    this.db.prepare('UPDATE flights SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  }

  async bulkUpdatePrices(rows) {
    const stmt = this.db.prepare(
      'UPDATE flights SET price_economy = @priceEconomy, price_first = @priceFirst, time_hours = @timeHours, updated_at = @updatedAt WHERE id = @id'
    );
    const now = new Date().toISOString();
    const tx = this.db.transaction((list) => {
      for (const r of list) stmt.run({ id: r.id, priceEconomy: r.priceEconomy, priceFirst: r.priceFirst, timeHours: r.timeHours, updatedAt: now });
    });
    tx(rows);
  }

  async bulkUpdateStatuses(idsToStatus) {
    const stmt = this.db.prepare('UPDATE flights SET status = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    const tx = this.db.transaction((pairs) => {
      for (const [id, status] of pairs) stmt.run(status, now, id);
    });
    tx(idsToStatus);
  }

  async insertOwnedTransaction(t) {
    this.db
      .prepare(
        `INSERT INTO seat_transactions (id, flight_id, seat_number, cabin_class, action_type, status, passenger_name, passenger_email, pnr, based_on_tx_id, price, origin_node, owner_node, lamport_ts, vector_clock_json, sync_status, conflict_reason, refund_available_at, created_at)
         VALUES (@id,@flightId,@seatNumber,@cabinClass,@actionType,@status,@passengerName,@passengerEmail,@pnr,@basedOnTxId,@price,@originNode,@ownerNode,@lamportTs,@vectorClockJson,@syncStatus,@conflictReason,@refundAvailableAt,@createdAt)`
      )
      .run(txParams(t));
  }

  /** Replica idempotente de una transaccion confirmada por el nodo dueno. */
  async upsertReplicatedTransaction(t) {
    this.db
      .prepare(
        `INSERT INTO seat_transactions (id, flight_id, seat_number, cabin_class, action_type, status, passenger_name, passenger_email, pnr, based_on_tx_id, price, origin_node, owner_node, lamport_ts, vector_clock_json, sync_status, conflict_reason, refund_available_at, created_at)
         VALUES (@id,@flightId,@seatNumber,@cabinClass,@actionType,@status,@passengerName,@passengerEmail,@pnr,@basedOnTxId,@price,@originNode,@ownerNode,@lamportTs,@vectorClockJson,@syncStatus,@conflictReason,@refundAvailableAt,@createdAt)
         ON CONFLICT(id) DO UPDATE SET
           status=excluded.status,
           sync_status=excluded.sync_status,
           conflict_reason=excluded.conflict_reason,
           refund_available_at=excluded.refund_available_at`
      )
      .run(txParams(t));
  }

  async updateOwnedTransactionStatus(id, status, extra = {}) {
    const fields = ['status = ?'];
    const params = [status];
    if (extra.conflictReason !== undefined) { fields.push('conflict_reason = ?'); params.push(extra.conflictReason); }
    if (extra.refundAvailableAt !== undefined) { fields.push('refund_available_at = ?'); params.push(extra.refundAvailableAt); }
    params.push(id);
    this.db.prepare(`UPDATE seat_transactions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  async getOwnedTransactionsForFlight(flightId) {
    return this.db
      .prepare('SELECT * FROM seat_transactions WHERE flight_id = ? ORDER BY lamport_ts ASC')
      .all(flightId)
      .map(txRowToObj);
  }

  async getOwnedTransactionById(id) {
    const row = this.db.prepare('SELECT * FROM seat_transactions WHERE id = ?').get(id);
    return row ? txRowToObj(row) : null;
  }

  async getAllOwnedTransactions() {
    return this.db.prepare('SELECT * FROM seat_transactions ORDER BY lamport_ts ASC').all().map(txRowToObj);
  }

  async close() {
    this.db.close();
  }
}

function txParams(t) {
  return {
    id: t.id,
    flightId: t.flightId,
    seatNumber: t.seatNumber,
    cabinClass: t.cabinClass,
    actionType: t.actionType,
    status: t.status,
    passengerName: t.passengerName || null,
    passengerEmail: t.passengerEmail || null,
    pnr: t.pnr || null,
    basedOnTxId: t.basedOnTxId || null,
    price: t.price ?? null,
    originNode: t.originNode,
    ownerNode: t.ownerNode,
    lamportTs: t.lamportTs,
    vectorClockJson: JSON.stringify(t.vectorClock),
    syncStatus: t.syncStatus,
    conflictReason: t.conflictReason || null,
    refundAvailableAt: t.refundAvailableAt || null,
    createdAt: t.createdAt,
  };
}

function flightRowToObj(row) {
  return {
    id: row.id,
    date: row.flight_date,
    time: row.flight_time,
    origin: row.origin,
    destination: row.destination,
    aircraftId: row.aircraft_id,
    aircraftModel: row.aircraft_model,
    status: row.status,
    gate: row.gate,
    ownerNode: row.owner_node,
    priceEconomy: row.price_economy,
    priceFirst: row.price_first,
    timeHours: row.time_hours,
  };
}

function txRowToObj(row) {
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

module.exports = { SqliteAdapter };
