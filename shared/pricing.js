'use strict';

const fs = require('fs');
const path = require('path');
const { loadAllMatrices, buildGraph } = require('./graph');

const PRICING_DIR = path.join(__dirname, '..', 'config', 'pricing');
const FILES = {
  economy: path.join(PRICING_DIR, 'economy_matrix.json'),
  first: path.join(PRICING_DIR, 'first_class_matrix.json'),
  time: path.join(PRICING_DIR, 'time_matrix.json'),
};

let cache = null;

function reload() {
  cache = loadAllMatrices();
  return cache;
}

function get() {
  if (!cache) reload();
  return cache;
}

function idx(order, code) {
  const i = order.indexOf(code);
  if (i === -1) throw new Error(`Aeropuerto desconocido: ${code}`);
  return i;
}

function getPrice(origin, destination, cabinClass) {
  const data = get();
  const table = cabinClass === 'FIRST' ? data.first : data.economy;
  const i = idx(table.order, origin);
  const j = idx(table.order, destination);
  return table.matrix[i][j];
}

function getTime(origin, destination) {
  const data = get();
  const i = idx(data.time.order, origin);
  const j = idx(data.time.order, destination);
  return data.time.matrix[i][j];
}

function hasDirectRoute(origin, destination) {
  return getPrice(origin, destination, 'ECONOMY') !== null || getPrice(origin, destination, 'FIRST') !== null;
}

function graphFor(weightKind) {
  const data = get();
  const table = weightKind === 'TIME' ? data.time : weightKind === 'FIRST' ? data.first : data.economy;
  const existsTable = weightKind === 'TIME' ? data.economy : table; // tiempo usa existencia de ruta economica como referencia
  return buildGraph(table.order, table.matrix, existsTable.matrix);
}

/** Persiste una matriz nueva (viene del editor "pegar desde Excel") y recarga la cache. */
function saveMatrix(kind, order, matrix, updatedBy) {
  const file = FILES[kind];
  if (!file) throw new Error(`Matriz desconocida: ${kind}`);
  const payload = {
    class: kind === 'time' ? undefined : kind === 'first' ? 'FIRST' : 'ECONOMY',
    unit: kind === 'time' ? 'hours' : undefined,
    currency: kind === 'time' ? undefined : 'USD',
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'admin',
    order,
    matrix,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  reload();
  return payload;
}

function exportRaw(kind) {
  const data = get();
  return kind === 'time' ? data.time : kind === 'first' ? data.first : data.economy;
}

/** Precio con fallback via Dijkstra multi-escala cuando no hay ruta directa en la matriz. */
function getPriceOrEstimate(origin, destination, cabinClass) {
  const direct = getPrice(origin, destination, cabinClass);
  if (direct !== null) return { value: direct, estimated: false };
  const { dijkstra } = require('./dijkstra');
  const graph = graphFor(cabinClass);
  const result = dijkstra(graph, origin, destination);
  return { value: result ? Math.round(result.total) : null, estimated: true };
}

module.exports = {
  get,
  reload,
  getPrice,
  getTime,
  hasDirectRoute,
  graphFor,
  saveMatrix,
  exportRaw,
  getPriceOrEstimate,
  FILES,
};
