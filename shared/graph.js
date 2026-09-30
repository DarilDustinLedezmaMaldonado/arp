'use strict';

const fs = require('fs');
const path = require('path');

function loadMatrix(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  // normaliza: cualquier 0 fuera de la diagonal en la matriz de Primera
  // Clase significa "sin ruta directa", igual que null en la de Economica.
  const order = raw.order;
  const m = raw.matrix.map((row, i) =>
    row.map((v, j) => {
      if (i === j) return 0;
      if (v === null || v === 0) return null;
      return v;
    })
  );
  return { order, matrix: m, meta: raw };
}

const PRICING_DIR = path.join(__dirname, '..', 'config', 'pricing');

function loadAllMatrices() {
  return {
    economy: loadMatrix(path.join(PRICING_DIR, 'economy_matrix.json')),
    first: loadMatrix(path.join(PRICING_DIR, 'first_class_matrix.json')),
    time: loadMatrix(path.join(PRICING_DIR, 'time_matrix.json')),
  };
}

/**
 * Construye una lista de adyacencia dirigida y ponderada a partir de una
 * matriz NxN. weightMatrix define el peso de la arista (costo o tiempo);
 * existsMatrix (opcional) define si la arista existe (por defecto, existe si
 * weightMatrix[i][j] no es null/0 fuera de diagonal).
 */
function buildGraph(order, weightMatrix, existsMatrix = null) {
  const adjacency = {};
  for (const code of order) adjacency[code] = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      if (i === j) continue;
      const exists = existsMatrix ? existsMatrix[i][j] !== null : weightMatrix[i][j] !== null;
      if (!exists) continue;
      const w = weightMatrix[i][j];
      if (w === null) continue;
      adjacency[order[i]].push({ to: order[j], weight: w });
    }
  }
  return adjacency;
}

module.exports = { loadMatrix, loadAllMatrices, buildGraph };
