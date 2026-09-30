'use strict';

/**
 * Reloj vectorial para N nodos (en este proyecto N=3: NODE_NA, NODE_EA, NODE_SA).
 * Representacion: objeto { NODE_NA: n, NODE_EA: n, NODE_SA: n }.
 *
 * Se usa para detectar CONCURRENCIA REAL entre eventos que tocan el mismo
 * asiento (p.ej. dos compras del mismo asiento aceptadas por dos nodos
 * distintos mientras estaban desconectados). A diferencia del reloj de
 * Lamport (que da un orden total pero no distingue "pasa-antes" de
 * "concurrente"), el reloj vectorial permite saber con certeza si un evento
 * A "sucedio antes" de B, B "antes" que A, o si son CONCURRENTES (conflicto
 * real que requiere resolucion determinista).
 */
const NODE_IDS = ['NODE_NA', 'NODE_EA', 'NODE_SA'];

function zero() {
  const v = {};
  for (const id of NODE_IDS) v[id] = 0;
  return v;
}

class VectorClock {
  constructor(nodeId, initial = null) {
    this.nodeId = nodeId;
    this.vector = initial ? { ...zero(), ...initial } : zero();
  }

  /** Evento local en este nodo: incrementa solo la propia componente. */
  tick() {
    this.vector[this.nodeId] += 1;
    return { ...this.vector };
  }

  /** Al recibir un evento replicado con vector remoto: merge (max componente a componente) + tick propio. */
  merge(remoteVector) {
    for (const id of NODE_IDS) {
      this.vector[id] = Math.max(this.vector[id] || 0, remoteVector[id] || 0);
    }
    this.vector[this.nodeId] += 1;
    return { ...this.vector };
  }

  snapshot() {
    return { ...this.vector };
  }

  /**
   * Compara dos vectores y determina su relacion causal.
   * @returns 'BEFORE' | 'AFTER' | 'CONCURRENT' | 'EQUAL'
   */
  static compare(vA, vB) {
    let aLessOrEqual = true;
    let bLessOrEqual = true;
    for (const id of NODE_IDS) {
      const a = vA[id] || 0;
      const b = vB[id] || 0;
      if (a > b) bLessOrEqual = false;
      if (b > a) aLessOrEqual = false;
    }
    if (aLessOrEqual && bLessOrEqual) return 'EQUAL';
    if (aLessOrEqual) return 'BEFORE'; // A sucede-antes de B
    if (bLessOrEqual) return 'AFTER'; // A sucede-despues de B
    return 'CONCURRENT';
  }

  /**
   * Resuelve un conflicto CONCURRENTE de forma deterministica e identica en
   * los 3 nodos: gana el timestamp de Lamport mas bajo; si empatan, gana el
   * nodeId menor alfabeticamente. Esto es lo que evita la sobreventa: ante
   * dos escrituras concurrentes sobre el mismo asiento, todos los nodos,
   * de forma independiente, llegan a la MISMA conclusion sobre cual gana.
   */
  static resolveConflict(eventA, eventB) {
    const relation = VectorClock.compare(eventA.vectorClock, eventB.vectorClock);
    if (relation === 'BEFORE') return { winner: eventB, loser: eventA, reason: 'CAUSAL' };
    if (relation === 'AFTER') return { winner: eventA, loser: eventB, reason: 'CAUSAL' };
    // CONCURRENT o EQUAL: desempate deterministico
    if (eventA.lamportTs !== eventB.lamportTs) {
      return eventA.lamportTs < eventB.lamportTs
        ? { winner: eventA, loser: eventB, reason: 'LAMPORT_TIEBREAK' }
        : { winner: eventB, loser: eventA, reason: 'LAMPORT_TIEBREAK' };
    }
    return eventA.originNode < eventB.originNode
      ? { winner: eventA, loser: eventB, reason: 'NODE_ID_TIEBREAK' }
      : { winner: eventB, loser: eventA, reason: 'NODE_ID_TIEBREAK' };
  }
}

module.exports = { VectorClock, NODE_IDS, zero };
