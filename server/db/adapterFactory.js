'use strict';

const { SqliteAdapter } = require('./adapters/sqliteAdapter');
const { MssqlAdapter } = require('./adapters/mssqlAdapter');
const { MongoAdapter } = require('./adapters/mongoAdapter');

/**
 * DB_DRIVER controla el motor de base de datos PRIMARIA de este nodo:
 *   - 'sqlite' (por defecto): modo local/demo en 1 PC, cero instalacion.
 *   - 'mssql' : SQL Server real (NODE_NA / NODE_EA en la entrega final).
 *   - 'mongo' : MongoDB real (NODE_SA en la entrega final).
 * Si no se especifica, se usa el driver "recomendado" para el nodo segun
 * config/nodes.json, pero siempre se puede forzar sqlite para pruebas.
 */
function createAdapter(nodeId, driverOverride) {
  const driver = (driverOverride || process.env.DB_DRIVER || 'sqlite').toLowerCase();
  if (driver === 'mssql') return new MssqlAdapter(nodeId);
  if (driver === 'mongo' || driver === 'mongodb') return new MongoAdapter(nodeId);
  return new SqliteAdapter(nodeId);
}

module.exports = { createAdapter };
