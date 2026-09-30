'use strict';

const { KeyedMutex } = require('./mutex');
const { layoverMinutes } = require('./flightCache');
const { newTxId, newPnr } = require('../../shared/idgen');
const { isSellable } = require('../../shared/flightStatus');

const mutex = new KeyedMutex();

// Tiempo maximo esperando a que un nodo dueno confirme una RESERVA. Pasado ese
// plazo la saga se aborta y compensa (las reservas que lleguen tarde se cancelan).
const DEFAULT_RESERVE_TIMEOUT_SECONDS = Number(process.env.SAGA_RESERVE_TIMEOUT_SECONDS || 45);
const MAX_LEGS = 4;
const ACTIVE = ['RESERVING', 'PURCHASING', 'COMPENSATING'];

class SagaError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_ITINERARY') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Compra combinada de un itinerario con escalas como SAGA ORQUESTADA.
 *
 * El nodo donde el cliente inicia la compra es el orquestador. Cada tramo puede
 * pertenecer a un nodo dueno distinto (NA/EA/SA), asi que no hay una
 * transaccion ACID que abarque a todos. En su lugar:
 *
 *   1. RESERVING    reserva (RESERVE) el asiento de cada tramo en su dueno.
 *   2. PURCHASING   si TODAS las reservas se confirman, convierte cada una en compra (PURCHASE).
 *   3. COMPLETED    todos los tramos vendidos.
 *
 *   Si un paso es rechazado (asiento ocupado, conflicto) o una reserva no se
 *   confirma a tiempo, la saga pasa a COMPENSATING y deshace lo ya hecho en orden
 *   inverso: CANCEL de cada reserva y REFUND de cada compra. Termina en ABORTED.
 *
 * Cada paso reutiliza BookingService (misma regla de negocio, relojes y outbox).
 * Si un dueno esta caido, el paso queda PENDING en el outbox y la saga espera:
 * nunca adivina el resultado de un paso. El estado de la saga se guarda en el
 * almacen local tras cada paso, y un worker la retoma tras reinicios.
 */
class SagaService {
  constructor(ctx, { reserveTimeoutSeconds = DEFAULT_RESERVE_TIMEOUT_SECONDS } = {}) {
    this.ctx = ctx;
    this.reserveTimeoutSeconds = reserveTimeoutSeconds;
  }

  async start({ legs, passengerName, passengerEmail }) {
    if (!passengerName) throw new SagaError('Falta el nombre del pasajero.', 400, 'MISSING_PASSENGER_NAME');
    if (!Array.isArray(legs) || legs.length < 2 || legs.length > MAX_LEGS) {
      throw new SagaError(`Un itinerario combinado necesita entre 2 y ${MAX_LEGS} tramos.`);
    }
    const flights = legs.map((leg) => {
      const flight = this.ctx.flightCache.get(leg && leg.flightId);
      if (!flight) throw new SagaError(`Vuelo no encontrado: ${leg && leg.flightId}`, 404, 'FLIGHT_NOT_FOUND');
      if (!leg.seatNumber) throw new SagaError(`Falta el asiento del vuelo ${flight.id}.`, 400, 'MISSING_SEAT');
      if (!isSellable(flight.status)) throw new SagaError(`El vuelo ${flight.id} ya no está a la venta (estado: ${flight.status}).`, 409, 'FLIGHT_NOT_SELLABLE');
      return flight;
    });
    for (let i = 1; i < flights.length; i++) {
      if (layoverMinutes(flights[i - 1], flights[i]) === null) {
        throw new SagaError(`El vuelo ${flights[i].id} no conecta con ${flights[i - 1].id} (escala entre 1 h y 24 h en el mismo aeropuerto).`, 400, 'BAD_CONNECTION');
      }
    }

    const now = new Date();
    const saga = {
      id: `SAGA-${newTxId(this.ctx.nodeId).slice(3)}`,
      pnr: newPnr(),
      status: 'RESERVING',
      orchestratorNode: this.ctx.nodeId,
      passengerName,
      passengerEmail: passengerEmail || null,
      legs: legs.map((leg, i) => ({
        flightId: flights[i].id,
        seatNumber: String(leg.seatNumber),
        ownerNode: flights[i].ownerNode,
        reserve: null,
        purchase: null,
        compensation: null,
      })),
      reason: null,
      reserveDeadline: new Date(now.getTime() + this.reserveTimeoutSeconds * 1000).toISOString(),
      log: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this._log(saga, 'SAGA_STARTED', `Itinerario ${flights.map((f) => f.origin).concat(flights.at(-1).destination).join(' → ')} para ${passengerName}`);
    this.ctx.systemStore.saveSaga(saga);
    return this.advance(saga.id);
  }

  get(id) {
    return this.ctx.systemStore.getSaga(id);
  }

  /** Avanza la saga todo lo posible sin esperar. Idempotente y serializada por saga. */
  advance(id) {
    return mutex.run(`saga:${id}`, async () => {
      const saga = this.ctx.systemStore.getSaga(id);
      if (!saga || !ACTIVE.includes(saga.status)) return saga;
      for (let guard = 0; guard < 50; guard++) {
        this._refresh(saga);
        const progressed = await this._step(saga);
        saga.updatedAt = new Date().toISOString();
        this.ctx.systemStore.saveSaga(saga);
        if (!progressed || !ACTIVE.includes(saga.status)) break;
      }
      return saga;
    });
  }

  /** Worker: retoma las sagas activas (pasos PENDING que el outbox ya resolvio, reintentos, plazos). */
  async tick() {
    for (const saga of this.ctx.systemStore.listActiveSagas()) {
      try { await this.advance(saga.id); } catch (err) { console.error(`[${this.ctx.nodeId}] saga ${saga.id}:`, err.message); }
    }
  }

  // ---------------------------------------------------------------- internals

  /** Un paso PENDING se resuelve cuando la decision del dueno llega a la replica local (via outbox). */
  _refresh(saga) {
    for (const leg of saga.legs) {
      for (const key of ['reserve', 'purchase', 'compensation']) {
        const step = leg[key];
        if (!step || step.status !== 'PENDING' || !step.txId) continue;
        const tx = this.ctx.systemStore.getReplicaTxById(step.txId);
        if (tx && tx.syncStatus === 'SYNCED' && tx.status !== 'PENDING') {
          step.status = tx.status;
          step.reason = tx.conflictReason || null;
          this._log(saga, 'STEP_RESOLVED', `${label(key)} ${leg.seatNumber} en ${leg.flightId}: ${tx.status} (confirmado por ${leg.ownerNode})`);
        }
      }
    }
  }

  async _step(saga) {
    if (saga.status === 'RESERVING') return this._reserving(saga);
    if (saga.status === 'PURCHASING') return this._purchasing(saga);
    if (saga.status === 'COMPENSATING') return this._compensating(saga);
    return false;
  }

  async _reserving(saga) {
    const expired = Date.now() > Date.parse(saga.reserveDeadline);
    for (const leg of saga.legs) {
      if (!leg.reserve) {
        leg.reserve = await this._action(saga, leg, 'RESERVE', null);
        return true;
      }
      const st = leg.reserve.status;
      if (st === 'RESERVED') continue;
      if (st === 'PENDING' || st === 'RETRY') {
        if (expired) {
          this._abort(saga, `El nodo ${leg.ownerNode} no confirmó la reserva de ${leg.flightId} a tiempo.`);
          return true;
        }
        if (st === 'RETRY') leg.reserve = null;
        return false;
      }
      this._abort(saga, `No se pudo reservar ${leg.seatNumber} en ${leg.flightId}: ${sentence(leg.reserve.reason || st)}`);
      return true;
    }
    saga.status = 'PURCHASING';
    this._log(saga, 'ALL_RESERVED', 'Todos los tramos reservados: se emiten las compras.');
    return true;
  }

  async _purchasing(saga) {
    for (const leg of saga.legs) {
      if (!leg.purchase) {
        leg.purchase = await this._action(saga, leg, 'PURCHASE', leg.reserve.txId);
        return true;
      }
      const st = leg.purchase.status;
      if (st === 'SOLD') continue;
      // Los asientos ya estan retenidos a nombre de la saga: se espera al dueno sin plazo.
      if (st === 'PENDING') return false;
      if (st === 'RETRY') { leg.purchase = null; return false; }
      this._abort(saga, `No se pudo emitir el boleto de ${leg.flightId}: ${sentence(leg.purchase.reason || st)}`);
      return true;
    }
    saga.status = 'COMPLETED';
    this._log(saga, 'SAGA_COMPLETED', `Itinerario confirmado: ${saga.legs.length} boletos emitidos.`);
    return true;
  }

  async _compensating(saga) {
    let waiting = false;
    // Orden inverso: se deshace primero lo ultimo que se hizo.
    for (const leg of [...saga.legs].reverse()) {
      const need = compensationFor(leg);
      if (need === 'WAIT') { waiting = true; continue; }
      if (!need) continue;
      if (!leg.compensation || leg.compensation.status === 'RETRY') {
        leg.compensation = await this._action(saga, leg, need.actionType, need.refTxId);
        return true;
      }
      if (leg.compensation.status === 'PENDING') waiting = true;
    }
    if (waiting) return false;
    saga.status = 'ABORTED';
    this._log(saga, 'SAGA_ABORTED', 'Compensación terminada: no queda ningún asiento retenido ni vendido por este itinerario.');
    return true;
  }

  _abort(saga, reason) {
    saga.status = 'COMPENSATING';
    saga.reason = reason;
    this._log(saga, 'SAGA_COMPENSATING', reason);
  }

  async _action(saga, leg, actionType, refTxId) {
    try {
      const result = await this.ctx.bookingService.requestSeatAction({
        flightId: leg.flightId,
        seatNumber: leg.seatNumber,
        actionType,
        passengerName: saga.passengerName,
        passengerEmail: saga.passengerEmail,
        refTxId,
      });
      const step = { actionType, txId: result.tx.id, status: result.tx.status, reason: result.tx.conflictReason || null };
      this._log(saga, 'STEP', `${label(actionType)} ${leg.seatNumber} en ${leg.flightId} → ${step.status}${result.pendingSync ? ` (esperando a ${leg.ownerNode})` : ''}`);
      return step;
    } catch (err) {
      // 4xx = decision de negocio definitiva; cualquier otra cosa se reintenta en el siguiente tick.
      const final = err.statusCode && err.statusCode < 500;
      this._log(saga, 'STEP', `${label(actionType)} ${leg.seatNumber} en ${leg.flightId} → ${final ? 'REJECTED' : 'reintento'}: ${err.message}`);
      return { actionType, txId: null, status: final ? 'REJECTED' : 'RETRY', reason: err.message };
    }
  }

  _log(saga, type, message) {
    const { lamportTs, vectorClock } = this.ctx.clockService.nextLocal();
    const at = new Date().toISOString();
    saga.log.push({ at, type, message, lamportTs });
    try {
      this.ctx.systemStore.appendEvent({
        id: `EVT-${saga.id}-${saga.log.length}`,
        eventType: type === 'STEP' || type === 'STEP_RESOLVED' ? 'SAGA_STEP' : type,
        summary: `[${saga.pnr}] ${message}`,
        originNode: this.ctx.nodeId,
        lamportTs,
        vectorClock,
      });
    } catch { /* el log de eventos es informativo */ }
  }
}

/** Que accion deshace un tramo, segun lo que el dueno confirmo. */
function compensationFor(leg) {
  const purchase = leg.purchase && leg.purchase.status;
  const reserve = leg.reserve && leg.reserve.status;
  if (purchase === 'SOLD') return { actionType: 'REFUND', refTxId: leg.purchase.txId };
  if (purchase === 'PENDING') return 'WAIT';
  if (reserve === 'RESERVED') return { actionType: 'CANCEL', refTxId: leg.reserve.txId };
  if (reserve === 'PENDING') return 'WAIT';
  return null;
}

const sentence = (text) => `${String(text).replace(/[.\s]+$/, '')}.`;

function label(action) {
  return { RESERVE: 'Reserva', reserve: 'Reserva', PURCHASE: 'Compra', purchase: 'Compra',
    CANCEL: 'Cancelación', REFUND: 'Devolución', compensation: 'Compensación' }[action] || action;
}

function startSagaWorker(ctx, intervalMs = 1500) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await ctx.sagaService.tick(); } catch (err) { console.error(`[${ctx.nodeId}] saga worker:`, err.message); }
    finally { running = false; }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { SagaService, SagaError, startSagaWorker, compensationFor };
