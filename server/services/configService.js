'use strict';

class ConfigService {
  constructor(systemStore) {
    this.store = systemStore;
  }

  getAll() {
    const raw = this.store.getAllConfig();
    return {
      soldPct: Number(raw.soldPct),
      reservedPct: Number(raw.reservedPct),
      refundDelaySeconds: Number(raw.refundDelaySeconds),
      currentSimulatedCountryNode: raw.currentSimulatedCountryNode,
    };
  }

  /** Aplica un cambio LOCAL (originado por el admin de este nodo). Devuelve el evento a difundir. */
  setLocal(key, value, clockService) {
    const { lamportTs } = clockService.nextLocal();
    this.store.setConfig(key, value, lamportTs);
    return { key, value, lamportTs };
  }

  /** Aplica un cambio RECIBIDO por replicacion (last-write-wins por lamportTs). */
  applyRemote(key, value, lamportTs) {
    this.store.setConfig(key, value, lamportTs);
  }
}

module.exports = { ConfigService };
