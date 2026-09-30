'use strict';

/**
 * Reloj de Lamport.
 * Regla 1: antes de un evento local, incrementar el reloj.
 * Regla 2: al enviar un mensaje, adjuntar el reloj actual.
 * Regla 3: al recibir un mensaje con timestamp T, reloj = max(reloj, T) + 1.
 *
 * Se usa para dar un orden total (parcial + desempate) a los eventos del
 * sistema (reservas, ventas, cancelaciones) a traves de los 3 nodos, y sirve
 * como criterio de desempate cuando el reloj vectorial detecta concurrencia
 * real (ver vectorClock.js).
 */
class LamportClock {
  constructor(initial = 0) {
    this.value = initial;
  }

  /** Regla 1: evento local. */
  tick() {
    this.value += 1;
    return this.value;
  }

  /** Regla 2: al enviar, se adjunta el valor actual (ya incrementado por tick()). */
  send() {
    return this.tick();
  }

  /** Regla 3: al recibir un mensaje con timestamp remoto. */
  receive(remoteTs) {
    this.value = Math.max(this.value, remoteTs) + 1;
    return this.value;
  }

  peek() {
    return this.value;
  }

  static compare(a, b) {
    return a - b;
  }
}

module.exports = { LamportClock };
