'use strict';
const { timingSafeEqual } = require('crypto');
const nodes = require('../../config/nodes.json').nodes;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function validateSecurity(env = process.env) {
  if (env.ALLOW_INSECURE_LOCAL === 'true') {
    if (env.DB_DRIVER !== 'sqlite' || env.BIND_HOST !== '127.0.0.1') throw new Error('Demo sin claves requiere SQLite y BIND_HOST=127.0.0.1.');
    return;
  }
  for (const key of ['SYNC_SECRET', 'ADMIN_SECRET']) {
    if (!env[key] || env[key].length < 32) throw new Error(`${key} debe contener al menos 32 caracteres.`);
  }
  if (env.SYNC_SECRET === env.ADMIN_SECRET) throw new Error('Usa claves distintas para administración y sincronización.');
}

function guard(kind, env = process.env) {
  return (req, res, next) => {
    if (env.ALLOW_INSECURE_LOCAL === 'true' && env.BIND_HOST === '127.0.0.1' && env.DB_DRIVER === 'sqlite') return next();
    const header = kind === 'sync' ? 'x-sync-secret' : 'x-admin-secret';
    const secret = kind === 'sync' ? env.SYNC_SECRET : env.ADMIN_SECRET;
    if (!secret || !equal(req.get(header), secret)) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Clave de acceso requerida o incorrecta.' });
    if (kind === 'sync' && !nodes[req.get('x-node-id')]) return res.status(403).json({ error: 'UNKNOWN_NODE' });
    next();
  };
}

function syncHeaders() {
  return { 'Content-Type': 'application/json', 'X-Node-ID': process.env.NODE_ID || '', 'X-Sync-Secret': process.env.SYNC_SECRET || '' };
}
module.exports = { guard, validateSecurity, syncHeaders };
