'use strict';

const sql = require('mssql');

/**
 * Adaptador SQL Server (driver oficial `mssql`, protocolo Tedious).
 * Usado por NODE_NA y NODE_EA segun el enunciado ("las otras 2 [bases de
 * datos] SQL Server"). Requiere una instancia real de SQL Server accesible
 * por red (local, en la LAN, o en la nube) configurada via variables de
 * entorno - ver .env.example:
 *   MSSQL_SERVER, MSSQL_PORT, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD,
 *   MSSQL_ENCRYPT (true/false), MSSQL_TRUST_CERT (true/false)
 *
 * Implementa exactamente la misma interfaz publica que sqliteAdapter.js y
 * mongoAdapter.js para que server/services/* no necesite saber que motor
 * de base de datos hay detras.
 */
class MssqlAdapter {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.kind = 'mssql';
  }

  async init() {
    const env = (name, fallback) => process.env[`${this.nodeId}_MSSQL_${name}`] || process.env[`MSSQL_${name}`] || fallback;
    const config = {
      server: env('SERVER', 'localhost'),
      port: Number(env('PORT', 1433)),
      database: env('DATABASE', `arp_${this.nodeId}`),
      user: env('USER'),
      password: env('PASSWORD'),
      options: {
        encrypt: String(env('ENCRYPT', 'false')) === 'true',
        trustServerCertificate: String(env('TRUST_CERT', 'true')) === 'true',
      },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      // 15 s (el valor por defecto) es poco para SQL Server Express en una laptop.
      connectionTimeout: Number(env('CONNECTION_TIMEOUT', 30000)),
      requestTimeout: Number(env('REQUEST_TIMEOUT', 120000)),
    };
    this.pool = await new sql.ConnectionPool(config).connect();
    await this._migrate();
  }

  async _migrate() {
    await this.pool.request().batch(`
      IF OBJECT_ID('dbo.flights','U') IS NULL
      CREATE TABLE dbo.flights (
        id VARCHAR(20) PRIMARY KEY,
        flight_date VARCHAR(10) NOT NULL,
        flight_time VARCHAR(5) NOT NULL,
        origin VARCHAR(3) NOT NULL,
        destination VARCHAR(3) NOT NULL,
        aircraft_id INT NOT NULL,
        aircraft_model VARCHAR(10) NOT NULL,
        status VARCHAR(20) NOT NULL,
        gate VARCHAR(10) NULL,
        owner_node VARCHAR(10) NOT NULL,
        price_economy FLOAT NULL,
        price_first FLOAT NULL,
        time_hours FLOAT NULL,
        updated_at VARCHAR(40) NULL
      );
    `);
    await this.pool.request().batch(`
      IF OBJECT_ID('dbo.seat_transactions','U') IS NULL
      CREATE TABLE dbo.seat_transactions (
        id VARCHAR(64) PRIMARY KEY,
        flight_id VARCHAR(20) NOT NULL,
        seat_number VARCHAR(10) NOT NULL,
        cabin_class VARCHAR(10) NOT NULL,
        action_type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        passenger_name NVARCHAR(100) NULL,
        passenger_email NVARCHAR(150) NULL,
        pnr VARCHAR(10) NULL,
        based_on_tx_id VARCHAR(64) NULL,
        price FLOAT NULL,
        origin_node VARCHAR(10) NOT NULL,
        owner_node VARCHAR(10) NOT NULL,
        lamport_ts INT NOT NULL,
        vector_clock_json NVARCHAR(200) NOT NULL,
        sync_status VARCHAR(20) NOT NULL,
        conflict_reason NVARCHAR(300) NULL,
        refund_available_at VARCHAR(40) NULL,
        created_at VARCHAR(40) NOT NULL
      );
    `);
    await this.pool.request().batch(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_flights_od')
      CREATE INDEX idx_flights_od ON dbo.flights(origin, destination);
    `);
    await this.pool.request().batch(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_flights_date_time')
      CREATE INDEX idx_flights_date_time ON dbo.flights(flight_date, flight_time);
    `);
    await this.pool.request().batch(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_tx_flight')
      CREATE INDEX idx_tx_flight ON dbo.seat_transactions(flight_id);
    `);
  }

  async bulkInsertFlights(flights) {
    const table = new sql.Table('dbo.flights');
    table.create = false;
    table.columns.add('id', sql.VarChar(20), { nullable: false });
    table.columns.add('flight_date', sql.VarChar(10), { nullable: false });
    table.columns.add('flight_time', sql.VarChar(5), { nullable: false });
    table.columns.add('origin', sql.VarChar(3), { nullable: false });
    table.columns.add('destination', sql.VarChar(3), { nullable: false });
    table.columns.add('aircraft_id', sql.Int, { nullable: false });
    table.columns.add('aircraft_model', sql.VarChar(10), { nullable: false });
    table.columns.add('status', sql.VarChar(20), { nullable: false });
    table.columns.add('gate', sql.VarChar(10), { nullable: true });
    table.columns.add('owner_node', sql.VarChar(10), { nullable: false });
    table.columns.add('price_economy', sql.Float, { nullable: true });
    table.columns.add('price_first', sql.Float, { nullable: true });
    table.columns.add('time_hours', sql.Float, { nullable: true });
    table.columns.add('updated_at', sql.VarChar(40), { nullable: true });

    // bulk insert en lotes para no exceder limites del driver
    const BATCH = 1000;
    for (let i = 0; i < flights.length; i += BATCH) {
      const batchTable = new sql.Table('dbo.flights');
      batchTable.create = false;
      batchTable.columns = table.columns;
      for (const f of flights.slice(i, i + BATCH)) {
        batchTable.rows.add(
          f.id, f.flightDate, f.flightTime, f.origin, f.destination, f.aircraftId,
          f.aircraftModel, f.status, f.gate || null, f.ownerNode,
          f.priceEconomy ?? null, f.priceFirst ?? null, f.timeHours ?? null, f.updatedAt || null
        );
      }
      const request = new sql.Request(this.pool);
      await request.bulk(batchTable);
    }
  }

  /** Todos los vuelos en una sola lectura (arranque del nodo: llena la cache en memoria). */
  async listAllFlights() {
    const r = await this.pool.request().query('SELECT * FROM dbo.flights');
    return r.recordset.map(flightRowToObj);
  }

  async getFlight(id) {
    const r = await this.pool.request().input('id', sql.VarChar(20), id).query('SELECT * FROM dbo.flights WHERE id = @id');
    return r.recordset[0] ? flightRowToObj(r.recordset[0]) : null;
  }

  async listFlights({ origin, destination, dateFrom, dateTo, ownerNode, status, limit = 50, offset = 0 } = {}) {
    const req = this.pool.request();
    let where = '1=1';
    if (origin) { where += ' AND origin = @origin'; req.input('origin', sql.VarChar(3), origin); }
    if (destination) { where += ' AND destination = @destination'; req.input('destination', sql.VarChar(3), destination); }
    if (dateFrom) { where += ' AND flight_date >= @dateFrom'; req.input('dateFrom', sql.VarChar(10), dateFrom); }
    if (dateTo) { where += ' AND flight_date <= @dateTo'; req.input('dateTo', sql.VarChar(10), dateTo); }
    if (ownerNode) { where += ' AND owner_node = @ownerNode'; req.input('ownerNode', sql.VarChar(10), ownerNode); }
    if (status) { where += ' AND status = @status'; req.input('status', sql.VarChar(20), status); }
    req.input('limit', sql.Int, limit).input('offset', sql.Int, offset);
    const query = `SELECT * FROM dbo.flights WHERE ${where} ORDER BY flight_date ASC, flight_time ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
    const r = await req.query(query);
    return r.recordset.map(flightRowToObj);
  }

  async countFlights(filters = {}) {
    const rows = await this.listFlights({ ...filters, limit: 1000000, offset: 0 });
    return rows.length;
  }

  async updateFlightStatus(id, status) {
    await this.pool
      .request()
      .input('id', sql.VarChar(20), id)
      .input('status', sql.VarChar(20), status)
      .input('updatedAt', sql.VarChar(40), new Date().toISOString())
      .query('UPDATE dbo.flights SET status = @status, updated_at = @updatedAt WHERE id = @id');
  }

  async bulkUpdatePrices(rows) {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin();
    try {
      const ps = new sql.PreparedStatement(transaction);
      ps.input('id', sql.VarChar(20));
      ps.input('pe', sql.Float);
      ps.input('pf', sql.Float);
      ps.input('th', sql.Float);
      ps.input('updatedAt', sql.VarChar(40));
      await ps.prepare('UPDATE dbo.flights SET price_economy = @pe, price_first = @pf, time_hours = @th, updated_at = @updatedAt WHERE id = @id');
      const now = new Date().toISOString();
      for (const r of rows) {
        await ps.execute({ id: r.id, pe: r.priceEconomy, pf: r.priceFirst, th: r.timeHours, updatedAt: now });
      }
      await ps.unprepare();
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async bulkUpdateStatuses(idsToStatus) {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin();
    try {
      const ps = new sql.PreparedStatement(transaction);
      ps.input('id', sql.VarChar(20));
      ps.input('status', sql.VarChar(20));
      ps.input('updatedAt', sql.VarChar(40));
      await ps.prepare('UPDATE dbo.flights SET status = @status, updated_at = @updatedAt WHERE id = @id');
      const now = new Date().toISOString();
      for (const [id, status] of idsToStatus) {
        await ps.execute({ id, status, updatedAt: now });
      }
      await ps.unprepare();
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async insertOwnedTransaction(t) {
    await this.pool
      .request()
      .input('id', sql.VarChar(64), t.id)
      .input('flightId', sql.VarChar(20), t.flightId)
      .input('seatNumber', sql.VarChar(10), t.seatNumber)
      .input('cabinClass', sql.VarChar(10), t.cabinClass)
      .input('actionType', sql.VarChar(20), t.actionType)
      .input('status', sql.VarChar(20), t.status)
      .input('passengerName', sql.NVarChar(100), t.passengerName || null)
      .input('passengerEmail', sql.NVarChar(150), t.passengerEmail || null)
      .input('pnr', sql.VarChar(10), t.pnr || null)
      .input('basedOnTxId', sql.VarChar(64), t.basedOnTxId || null)
      .input('price', sql.Float, t.price || null)
      .input('originNode', sql.VarChar(10), t.originNode)
      .input('ownerNode', sql.VarChar(10), t.ownerNode)
      .input('lamportTs', sql.Int, t.lamportTs)
      .input('vectorClockJson', sql.NVarChar(200), JSON.stringify(t.vectorClock))
      .input('syncStatus', sql.VarChar(20), t.syncStatus)
      .input('conflictReason', sql.NVarChar(300), t.conflictReason || null)
      .input('refundAvailableAt', sql.VarChar(40), t.refundAvailableAt || null)
      .input('createdAt', sql.VarChar(40), t.createdAt)
      .query(`INSERT INTO dbo.seat_transactions
        (id, flight_id, seat_number, cabin_class, action_type, status, passenger_name, passenger_email, pnr, based_on_tx_id, price, origin_node, owner_node, lamport_ts, vector_clock_json, sync_status, conflict_reason, refund_available_at, created_at)
        VALUES (@id,@flightId,@seatNumber,@cabinClass,@actionType,@status,@passengerName,@passengerEmail,@pnr,@basedOnTxId,@price,@originNode,@ownerNode,@lamportTs,@vectorClockJson,@syncStatus,@conflictReason,@refundAvailableAt,@createdAt)`);
  }

  /** MERGE idempotente para mantener una copia de las transacciones de los otros nodos. */
  async upsertReplicatedTransaction(t) {
    await this.pool
      .request()
      .input('id', sql.VarChar(64), t.id)
      .input('flightId', sql.VarChar(20), t.flightId)
      .input('seatNumber', sql.VarChar(10), t.seatNumber)
      .input('cabinClass', sql.VarChar(10), t.cabinClass)
      .input('actionType', sql.VarChar(20), t.actionType)
      .input('status', sql.VarChar(20), t.status)
      .input('passengerName', sql.NVarChar(100), t.passengerName || null)
      .input('passengerEmail', sql.NVarChar(150), t.passengerEmail || null)
      .input('pnr', sql.VarChar(10), t.pnr || null)
      .input('basedOnTxId', sql.VarChar(64), t.basedOnTxId || null)
      .input('price', sql.Float, t.price ?? null)
      .input('originNode', sql.VarChar(10), t.originNode)
      .input('ownerNode', sql.VarChar(10), t.ownerNode)
      .input('lamportTs', sql.Int, t.lamportTs)
      .input('vectorClockJson', sql.NVarChar(200), JSON.stringify(t.vectorClock))
      .input('syncStatus', sql.VarChar(20), t.syncStatus)
      .input('conflictReason', sql.NVarChar(300), t.conflictReason || null)
      .input('refundAvailableAt', sql.VarChar(40), t.refundAvailableAt || null)
      .input('createdAt', sql.VarChar(40), t.createdAt)
      .query(`MERGE dbo.seat_transactions WITH (HOLDLOCK) AS target
        USING (SELECT @id AS id) AS source ON target.id = source.id
        WHEN MATCHED THEN UPDATE SET
          status=@status, sync_status=@syncStatus, conflict_reason=@conflictReason, refund_available_at=@refundAvailableAt
        WHEN NOT MATCHED THEN INSERT
          (id, flight_id, seat_number, cabin_class, action_type, status, passenger_name, passenger_email, pnr, based_on_tx_id, price, origin_node, owner_node, lamport_ts, vector_clock_json, sync_status, conflict_reason, refund_available_at, created_at)
        VALUES
          (@id,@flightId,@seatNumber,@cabinClass,@actionType,@status,@passengerName,@passengerEmail,@pnr,@basedOnTxId,@price,@originNode,@ownerNode,@lamportTs,@vectorClockJson,@syncStatus,@conflictReason,@refundAvailableAt,@createdAt);`);
  }

  async updateOwnedTransactionStatus(id, status, extra = {}) {
    const req = this.pool.request().input('id', sql.VarChar(64), id).input('status', sql.VarChar(20), status);
    let setClauses = ['status = @status'];
    if (extra.conflictReason !== undefined) { setClauses.push('conflict_reason = @conflictReason'); req.input('conflictReason', sql.NVarChar(300), extra.conflictReason); }
    if (extra.refundAvailableAt !== undefined) { setClauses.push('refund_available_at = @refundAvailableAt'); req.input('refundAvailableAt', sql.VarChar(40), extra.refundAvailableAt); }
    await req.query(`UPDATE dbo.seat_transactions SET ${setClauses.join(', ')} WHERE id = @id`);
  }

  async getOwnedTransactionsForFlight(flightId) {
    const r = await this.pool
      .request()
      .input('flightId', sql.VarChar(20), flightId)
      .query('SELECT * FROM dbo.seat_transactions WHERE flight_id = @flightId ORDER BY lamport_ts ASC');
    return r.recordset.map(txRowToObj);
  }

  async getOwnedTransactionById(id) {
    const r = await this.pool.request().input('id', sql.VarChar(64), id).query('SELECT * FROM dbo.seat_transactions WHERE id = @id');
    return r.recordset[0] ? txRowToObj(r.recordset[0]) : null;
  }

  async getAllOwnedTransactions() {
    const r = await this.pool.request().query('SELECT * FROM dbo.seat_transactions ORDER BY lamport_ts ASC');
    return r.recordset.map(txRowToObj);
  }

  async close() {
    await this.pool.close();
  }
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

module.exports = { MssqlAdapter };
