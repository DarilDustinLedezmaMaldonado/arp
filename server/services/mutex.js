'use strict';

/**
 * Mutex por clave (ej. "F-000123::14C"), implementado encadenando promesas.
 * Node.js es single-thread, pero dos requests HTTP concurrentes que hacen
 * "leer estado -> decidir -> escribir" sobre el MISMO asiento pueden
 * intercalarse en un `await` intermedio y generar una condicion de carrera
 * local (perder una actualizacion). Este mutex evita eso DENTRO de un mismo
 * nodo; la coordinacion ENTRE nodos la dan los relojes vectoriales +
 * resolucion de conflictos (ver vectorClock.js y bookingService.js).
 */
class KeyedMutex {
  constructor() {
    this._chains = new Map();
  }

  async run(key, fn) {
    const prev = this._chains.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = prev.then(() => current);
    this._chains.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this._chains.get(key) === tail) this._chains.delete(key);
    }
  }
}

module.exports = { KeyedMutex, seatKey: (flightId, seatNumber) => `${flightId}::${seatNumber}` };
