'use strict';

const crypto = require('crypto');

// Criterio de conexion: una "conexion" es una sesion de un cliente (navegador)
// con ESTE nodo. Si el mismo cliente pasa mas de SESSION_GAP_MS sin hacer
// ninguna peticion, su siguiente peticion abre una conexion nueva.
const SESSION_GAP_MS = 30 * 60 * 1000;
const FLUSH_MS = 5000;

/**
 * Cuenta las conexiones de clientes a este nodo y cuantas de ellas se usaron
 * para comprar pasajes. Cada sesion nueva se guarda al instante en el almacen
 * local; los contadores (peticiones, compras, ultima actividad) se escriben
 * en lote cada pocos segundos para no hacer un fsync por cada peticion.
 */
class ConnectionTracker {
  constructor(systemStore, { gapMs = SESSION_GAP_MS, now = () => Date.now() } = {}) {
    this.store = systemStore;
    this.gapMs = gapMs;
    this.now = now;
    this.byClient = new Map();
    this.dirty = new Set();
  }

  /** Identidad del cliente: la que manda el navegador o, si no, un hash de IP + navegador. */
  static clientIdFor(req) {
    const sent = req.get('x-client-id');
    if (sent && /^[\w-]{8,64}$/.test(sent)) return sent;
    const raw = `${req.ip || ''}|${req.get('user-agent') || ''}`;
    return `anon-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
  }

  /** Registra una peticion del cliente y devuelve su sesion (abriendo una nueva si corresponde). */
  touch(clientId, ip) {
    const at = this.now();
    let session = this.byClient.get(clientId);
    if (!session || at - session.lastSeen > this.gapMs) {
      session = {
        id: crypto.randomUUID(),
        clientId,
        ip: ip || null,
        startedAt: at,
        lastSeen: at,
        requests: 1,
        purchaseRequests: 0,
      };
      this.byClient.set(clientId, session);
      this.store.saveClientSession(session);
      return session;
    }
    session.lastSeen = at;
    session.requests++;
    this.dirty.add(session);
    return session;
  }

  /** La sesion hizo una solicitud de compra o reserva (asiento suelto o itinerario). */
  countPurchase(session) {
    if (!session) return;
    session.purchaseRequests++;
    this.store.saveClientSession(session);
    this.dirty.delete(session);
  }

  flush() {
    for (const session of this.dirty) this.store.saveClientSession(session);
    this.dirty.clear();
  }

  /** Middleware para /api: cuenta la conexion y la deja en req.clientSession. */
  middleware() {
    return (req, res, next) => {
      try { req.clientSession = this.touch(ConnectionTracker.clientIdFor(req), req.ip); } catch { /* el conteo nunca bloquea una peticion */ }
      next();
    };
  }

  start() {
    const timer = setInterval(() => { try { this.flush(); } catch { /* reintenta en el siguiente ciclo */ } }, FLUSH_MS);
    timer.unref();
    return timer;
  }
}

module.exports = { ConnectionTracker, SESSION_GAP_MS };
