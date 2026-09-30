'use strict';

const { MongoClient } = require('mongodb');

/**
 * Adaptador MongoDB. Usado por NODE_SA (Sudamerica) segun el enunciado
 * ("la de sudamerica debe ser bdd mongo"). Requiere una instancia real de
 * MongoDB accesible por red - ver .env.example: MONGO_URI, MONGO_DB.
 * Implementa la misma interfaz publica que sqliteAdapter.js / mssqlAdapter.js.
 */
class MongoAdapter {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.kind = 'mongo';
  }

  async init() {
    const uri = process.env[`${this.nodeId}_MONGO_URI`] || process.env.MONGO_URI || 'mongodb://localhost:27017';
    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(process.env[`${this.nodeId}_MONGO_DB`] || process.env.MONGO_DB || `arp_${this.nodeId}`);
    this.flights = this.db.collection('flights');
    this.tx = this.db.collection('seat_transactions');
    await this.flights.createIndex({ id: 1 }, { unique: true });
    await this.flights.createIndex({ origin: 1, destination: 1 });
    await this.flights.createIndex({ ownerNode: 1 });
    await this.tx.createIndex({ id: 1 }, { unique: true });
    await this.tx.createIndex({ flightId: 1 });
  }

  async bulkInsertFlights(flights) {
    if (flights.length === 0) return;
    const ops = flights.map((f) => ({
      updateOne: { filter: { id: f.id }, update: { $set: f }, upsert: true },
    }));
    const BATCH = 1000;
    for (let i = 0; i < ops.length; i += BATCH) {
      await this.flights.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    }
  }

  async getFlight(id) {
    const doc = await this.flights.findOne({ id });
    return doc ? flightDocToObj(stripMongoId(doc)) : null;
  }

  async listFlights({ origin, destination, dateFrom, dateTo, ownerNode, status, limit = 50, offset = 0 } = {}) {
    const filter = {};
    if (origin) filter.origin = origin;
    if (destination) filter.destination = destination;
    if (ownerNode) filter.ownerNode = ownerNode;
    if (status) filter.status = status;
    if (dateFrom || dateTo) {
      filter.flightDate = {};
      if (dateFrom) filter.flightDate.$gte = dateFrom;
      if (dateTo) filter.flightDate.$lte = dateTo;
    }
    const docs = await this.flights
      .find(filter)
      .sort({ flightDate: 1, flightTime: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return docs.map(stripMongoId).map(flightDocToObj);
  }

  async countFlights(filters = {}) {
    const filter = {};
    if (filters.origin) filter.origin = filters.origin;
    if (filters.destination) filter.destination = filters.destination;
    if (filters.ownerNode) filter.ownerNode = filters.ownerNode;
    if (filters.status) filter.status = filters.status;
    return this.flights.countDocuments(filter);
  }

  async updateFlightStatus(id, status) {
    await this.flights.updateOne({ id }, { $set: { status, updatedAt: new Date().toISOString() } });
  }

  async bulkUpdatePrices(rows) {
    const now = new Date().toISOString();
    const ops = rows.map((r) => ({
      updateOne: { filter: { id: r.id }, update: { $set: { priceEconomy: r.priceEconomy, priceFirst: r.priceFirst, timeHours: r.timeHours, updatedAt: now } } },
    }));
    const BATCH = 2000;
    for (let i = 0; i < ops.length; i += BATCH) {
      await this.flights.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    }
  }

  async bulkUpdateStatuses(idsToStatus) {
    const now = new Date().toISOString();
    const ops = idsToStatus.map(([id, status]) => ({
      updateOne: { filter: { id }, update: { $set: { status, updatedAt: now } } },
    }));
    if (ops.length) await this.flights.bulkWrite(ops, { ordered: false });
  }

  async insertOwnedTransaction(t) {
    await this.tx.insertOne({ ...t });
  }

  async upsertReplicatedTransaction(t) {
    await this.tx.updateOne({ id: t.id }, { $set: { ...t } }, { upsert: true });
  }

  async updateOwnedTransactionStatus(id, status, extra = {}) {
    const set = { status };
    if (extra.conflictReason !== undefined) set.conflictReason = extra.conflictReason;
    if (extra.refundAvailableAt !== undefined) set.refundAvailableAt = extra.refundAvailableAt;
    await this.tx.updateOne({ id }, { $set: set });
  }

  async getOwnedTransactionsForFlight(flightId) {
    const docs = await this.tx.find({ flightId }).sort({ lamportTs: 1 }).toArray();
    return docs.map(stripMongoId);
  }

  async getOwnedTransactionById(id) {
    const doc = await this.tx.findOne({ id });
    return doc ? stripMongoId(doc) : null;
  }

  async getAllOwnedTransactions() {
    const docs = await this.tx.find({}).sort({ lamportTs: 1 }).toArray();
    return docs.map(stripMongoId);
  }

  async close() {
    await this.client.close();
  }
}

function stripMongoId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

// Mongo guarda los campos ya en camelCase tal cual los insertamos, pero
// normalizamos nombres para que coincida con el resto de adaptadores
// (que exponen flightDate/flightTime como date/time).
function flightDocToObj(doc) {
  return {
    id: doc.id,
    date: doc.flightDate,
    time: doc.flightTime,
    origin: doc.origin,
    destination: doc.destination,
    aircraftId: doc.aircraftId,
    aircraftModel: doc.aircraftModel,
    status: doc.status,
    gate: doc.gate,
    ownerNode: doc.ownerNode,
    priceEconomy: doc.priceEconomy,
    priceFirst: doc.priceFirst,
    timeHours: doc.timeHours,
  };
}

module.exports = { MongoAdapter };
