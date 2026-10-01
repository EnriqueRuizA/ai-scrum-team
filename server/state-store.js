// server/state-store.js - FASE 1: lock explicito de ejecucion.
// Sustituye el flag `isRunning` (con carrera entre dos POST /api/start
// simultaneos). Un solo vuelo por proceso; 409 si ya hay run activo.

class RunLock {
  constructor() {
    this.holder = null;
  }

  isLocked() {
    return this.holder !== null;
  }

  getInfo() {
    return this.holder ? { ...this.holder } : null;
  }

  tryAcquire(info = {}) {
    if (this.holder !== null) return false;
    this.holder = {
      startedAt: new Date().toISOString(),
      ...info
    };
    return true;
  }

  release() {
    this.holder = null;
  }
}

module.exports = { RunLock };
