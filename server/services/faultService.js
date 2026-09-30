'use strict';

class FaultService {
  constructor(systemStore) {
    this.store = systemStore;
  }

  state() {
    return this.store.getFaultState();
  }

  isDbDown() {
    return this.store.getFaultState().dbDown;
  }

  isNetworkPartitioned() {
    return this.store.getFaultState().networkPartitioned;
  }

  setDbDown(down) {
    return this.store.setFaultState({ dbDown: down });
  }

  setNetworkPartitioned(partitioned) {
    return this.store.setFaultState({ networkPartitioned: partitioned });
  }
}

module.exports = { FaultService };
