'use strict';

const { LamportClock } = require('../../shared/lamportClock');
const { VectorClock } = require('../../shared/vectorClock');

class ClockService {
  constructor(nodeId, systemStore) {
    this.nodeId = nodeId;
    this.store = systemStore;
    const saved = systemStore.loadClocks();
    this.lamport = new LamportClock(saved.lamport);
    this.vector = new VectorClock(nodeId, saved.vector);
  }

  _persist() {
    this.store.saveClocks(this.lamport.peek(), this.vector.snapshot());
  }

  /** Para un evento generado LOCALMENTE en este nodo. */
  nextLocal() {
    const lamportTs = this.lamport.tick();
    const vectorClock = this.vector.tick();
    this._persist();
    return { lamportTs, vectorClock };
  }

  /** Al recibir un evento de otro nodo con su propio timestamp/vector. */
  receiveRemote(remoteLamportTs, remoteVectorClock) {
    const lamportTs = this.lamport.receive(remoteLamportTs);
    const vectorClock = this.vector.merge(remoteVectorClock);
    this._persist();
    return { lamportTs, vectorClock };
  }

  peek() {
    return { lamportTs: this.lamport.peek(), vectorClock: this.vector.snapshot() };
  }
}

module.exports = { ClockService };
