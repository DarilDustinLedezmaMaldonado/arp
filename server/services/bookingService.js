'use strict';

const { KeyedMutex, seatKey } = require('./mutex');
const { authoritativeApply, mirrorConfirmed } = require('./syncCore');
const { isEffective } = require('../../shared/transactionState');
const { isSellable } = require('../../shared/flightStatus');
const { newTxId, newPnr } = require('../../shared/idgen');
const { generateBaseSeatMap, applyOverlay, aggregateStats } = require('../../shared/seatMap');
const { sendSyncEvent } = require('../sync/replicationClient');
const mutex = new KeyedMutex();

class BookingError extends Error {
  constructor(message, statusCode = 409, code = 'BOOKING_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

class BookingService {
  constructor(ctx) {
    // ctx: { nodeId, systemStore, primaryAdapter, clockService, faultService, configService, flightCache }
    this.ctx = ctx;
  }

  /** Construye el mapa de asientos "vivo" (base deterministico + overlay de transacciones conocidas por este nodo). */
  liveSeatMap(flightId) {
    const flight = this.ctx.flightCache.get(flightId);
    if (!flight) throw new BookingError('Vuelo no encontrado', 404, 'FLIGHT_NOT_FOUND');
    const cfg = this.ctx.configService.getAll();
    const base = generateBaseSeatMap(
      flightId,
      flight.aircraftModel,
      { soldPct: cfg.soldPct, reservedPct: cfg.reservedPct },
      { economy: flight.priceEconomy, first: flight.priceFirst }
    );
    const overlay = this.ctx.systemStore.getReplicaTxForFlight(flightId);
    const seats = applyOverlay(base, overlay);
    return { flight, seats, stats: aggregateStats(seats) };
  }

  /** Ultima transaccion "valida" (no perdedora de conflicto) de un asiento segun la replica local de este nodo. */
  latestTxForSeat(flightId, seatNumber) {
    const all = this.ctx.systemStore
      .getReplicaTxForFlight(flightId)
      .filter((t) => t.seatNumber === seatNumber && isEffective(t));
    return all.length ? all[all.length - 1] : null;
  }

  findSeat(flightId, seatNumber) {
    const { seats } = this.liveSeatMap(flightId);
    return seats.find((s) => s.seatNumber === seatNumber) || null;
  }

  /**
   * Punto de entrada principal: procesa una accion sobre un asiento
   * (RESERVE, PURCHASE, CANCEL, REFUND, CHECKIN) llegue de donde llegue.
   */
  async requestSeatAction({ flightId, seatNumber, actionType, passengerName, passengerEmail, refTxId }) {
    return mutex.run(seatKey(flightId, seatNumber), () =>
      this._requestSeatActionLocked({ flightId, seatNumber, actionType, passengerName, passengerEmail, refTxId })
    );
  }

  async _requestSeatActionLocked({ flightId, seatNumber, actionType, passengerName, passengerEmail, refTxId }) {
    const flight = this.ctx.flightCache.get(flightId);
    if (!flight) throw new BookingError('Vuelo no encontrado', 404, 'FLIGHT_NOT_FOUND');

    if ((actionType === 'RESERVE' || actionType === 'PURCHASE') && !isSellable(flight.status)) {
      throw new BookingError(`El vuelo ${flightId} ya no está a la venta (estado: ${flight.status}).`, 409, 'FLIGHT_NOT_SELLABLE');
    }

    const seat = this.findSeat(flightId, seatNumber);
    if (!seat) throw new BookingError('Asiento no encontrado', 404, 'SEAT_NOT_FOUND');

    this._validateBusinessRule(actionType, seat, refTxId);

    const status = { RESERVE: 'RESERVED', PURCHASE: 'SOLD', CANCEL: 'AVAILABLE', REFUND: 'REFUNDED', CHECKIN: 'CHECKED_IN' }[actionType];
    const cfg = this.ctx.configService.getAll();
    const { lamportTs, vectorClock } = this.ctx.clockService.nextLocal();

    const event = {
      id: newTxId(this.ctx.nodeId),
      flightId,
      seatNumber,
      cabinClass: seat.cabinClass,
      actionType,
      status,
      passengerName: actionType === 'RESERVE' || actionType === 'PURCHASE' ? passengerName || seat.passengerName : seat.passengerName,
      passengerEmail: passengerEmail || seat.passengerEmail || null,
      // al convertir una reserva propia en compra se conserva el mismo PNR
      pnr: actionType === 'RESERVE' ? newPnr() : actionType === 'PURCHASE' ? (refTxId && seat.pnr ? seat.pnr : newPnr()) : seat.pnr,
      price: seat.cabinClass === 'FIRST' ? flight.priceFirst : flight.priceEconomy,
      basedOnTxId: refTxId || null,
      originNode: this.ctx.nodeId,
      ownerNode: flight.ownerNode,
      lamportTs,
      vectorClock,
      syncStatus: 'SYNCED',
      conflictReason: null,
      refundAvailableAt: actionType === 'REFUND' ? new Date(Date.now() + cfg.refundDelaySeconds * 1000).toISOString() : null,
      createdAt: new Date().toISOString(),
    };

    // Persist request before attempting the owner: timeouts and crashes never
    // lose accepted work. The same ID is retried; business errors are terminal.
    const pendingEvent = { ...event, status: 'PENDING', syncStatus: 'LOCAL_PENDING' };
    this.ctx.systemStore.savePending(pendingEvent);
    if (this.ctx.faultService.isNetworkPartitioned() && flight.ownerNode !== this.ctx.nodeId) {
      return { tx: pendingEvent, pendingSync: true, conflict: false };
    }
    let response;
    try {
      response = flight.ownerNode === this.ctx.nodeId
        ? await authoritativeApply(this.ctx, event)
        : await sendSyncEvent(flight.ownerNode, { kind: 'SEAT_TX_REQUEST', event });
    } catch (err) {
      if (err.statusCode && err.statusCode < 500 && err.statusCode !== 429) {
        this.ctx.systemStore.upsertReplicaTx({ ...event, status: 'REJECTED', syncStatus: 'SYNCED', conflictReason: err.message });
        this.ctx.systemStore.markOutboxDelivered(`REQUEST-${event.id}`);
        throw err;
      }
      return { tx: pendingEvent, pendingSync: true, conflict: false };
    }
    // Owner has confirmed. Local replication may remain queued without
    // downgrading the ticket to PENDING on a local DB failure.
    this.ctx.systemStore.upsertReplicaTx(response.tx);
    try {
      await mirrorConfirmed(this.ctx, response.tx);
      this.ctx.systemStore.markOutboxDelivered(`REQUEST-${event.id}`);
    } catch { /* owner's durable outbox and local request retry both persist it */ }
    return { ...response, pendingSync: false };
  }

  _validateBusinessRule(actionType, seat, refTxId) {
    if (actionType === 'RESERVE' && seat.status !== 'AVAILABLE') {
      throw new BookingError(`El asiento ${seat.seatNumber} ya no esta disponible (estado actual: ${seat.status}).`, 409, 'SEAT_UNAVAILABLE');
    }
    if (actionType === 'PURCHASE') {
      // Se puede comprar un asiento libre, o convertir en compra una reserva PROPIA (mismo txId).
      const upgradingOwnReservation = seat.status === 'RESERVED' && refTxId && seat.txId === refTxId;
      if (seat.status !== 'AVAILABLE' && !upgradingOwnReservation) {
        throw new BookingError(`El asiento ${seat.seatNumber} ya no esta disponible (estado actual: ${seat.status}).`, 409, 'SEAT_UNAVAILABLE');
      }
    }
    if (['CANCEL', 'REFUND', 'CHECKIN'].includes(actionType)) {
      // Sin login: el txId actua como "llave" de la reserva. Solo quien lo conoce puede operar sobre ese asiento.
      if (!refTxId || seat.txId !== refTxId) {
        throw new BookingError('Ese boleto no corresponde al asiento indicado (o ya fue reemplazado por otra operacion).', 409, 'TX_MISMATCH');
      }
    }
    if (actionType === 'CANCEL' && seat.status !== 'RESERVED') {
      throw new BookingError(`Solo se puede cancelar un asiento RESERVADO (estado actual: ${seat.status}).`, 409, 'INVALID_STATE');
    }
    if (actionType === 'REFUND' && seat.status !== 'SOLD') {
      throw new BookingError(`Solo se puede pedir devolucion de un asiento VENDIDO (estado actual: ${seat.status}).`, 409, 'INVALID_STATE');
    }
    if (actionType === 'CHECKIN' && seat.status !== 'SOLD') {
      throw new BookingError(`Solo se puede hacer check-in de un asiento VENDIDO (estado actual: ${seat.status}).`, 409, 'INVALID_STATE');
    }
  }

}

module.exports = { BookingService, BookingError };
