'use strict';

const { dijkstra } = require('./dijkstra');

/**
 * Calcula distancias "efectivas" (costo minimo o tiempo minimo, permitiendo
 * escalas) entre cada par de nodos en `nodes`, usando Dijkstra sobre el grafo
 * completo (adjacency puede incluir aeropuertos fuera de `nodes`, se usan
 * como posibles escalas). Necesario porque la red NO es un grafo completo
 * (no todos los destinos tienen ruta de retorno / ruta directa).
 */
function effectiveDistanceMatrix(adjacency, nodes) {
  const dist = {};
  const pathInfo = {};
  for (const a of nodes) {
    dist[a] = {};
    pathInfo[a] = {};
    for (const b of nodes) {
      if (a === b) {
        dist[a][b] = 0;
        pathInfo[a][b] = { path: [a], legs: [] };
        continue;
      }
      const result = dijkstra(adjacency, a, b);
      dist[a][b] = result ? result.total : Infinity;
      pathInfo[a][b] = result ? { path: result.path, legs: result.legs } : null;
    }
  }
  return { dist, pathInfo };
}

/**
 * TSP exacto (Held-Karp, programacion dinamica sobre subconjuntos) para
 * grafos DIRIGIDOS y asimetricos (ATSP). Factible para N <= ~15 (2^15 * 15^2
 * ~ 7.4M operaciones), que es exactamente nuestro caso (15 aeropuertos).
 *
 * @param {string[]} nodes lista de aeropuertos a visitar (incluye el origen en indice 0)
 * @param {Object} dist matriz de distancias efectivas (post Dijkstra)
 * @param {'CYCLE'|'PATH'} mode CYCLE = regresar al origen, PATH = terminar en cualquier nodo
 */
function heldKarpTSP(nodes, dist, mode = 'PATH') {
  const n = nodes.length;
  if (n <= 1) return { order: nodes, total: 0 };
  if (n > 18) throw new Error('Demasiados aeropuertos para TSP exacto (limite 18)');

  const FULL = (1 << n) - 1;
  const INF = Infinity;
  // dp[mask][j] = costo minimo para visitar exactamente `mask` (bit=visitado),
  // empezando en el nodo 0 y terminando en el nodo j
  const dp = Array.from({ length: 1 << n }, () => new Array(n).fill(INF));
  const parent = Array.from({ length: 1 << n }, () => new Array(n).fill(-1));

  dp[1][0] = 0; // solo visitado el origen (bit 0), terminando en el origen

  for (let mask = 1; mask <= FULL; mask++) {
    if (!(mask & 1)) continue; // el origen siempre debe estar incluido
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask][j];
      if (cur === INF) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue; // ya visitado
        const w = dist[nodes[j]][nodes[k]];
        if (w === undefined || w === INF) continue;
        const nextMask = mask | (1 << k);
        const alt = cur + w;
        if (alt < dp[nextMask][k]) {
          dp[nextMask][k] = alt;
          parent[nextMask][k] = j;
        }
      }
    }
  }

  let bestEnd = -1;
  let bestCost = INF;
  for (let j = 0; j < n; j++) {
    if (j === 0 && n > 1) continue;
    let cost = dp[FULL][j];
    if (cost === INF) continue;
    if (mode === 'CYCLE') {
      const back = dist[nodes[j]][nodes[0]];
      if (back === undefined || back === INF) continue;
      cost += back;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestEnd = j;
    }
  }

  if (bestEnd === -1) return null; // no existe ruta que cubra todos los nodos pedidos

  // Reconstruir orden
  const orderIdx = [];
  let mask = FULL;
  let cur = bestEnd;
  while (cur !== -1) {
    orderIdx.unshift(cur);
    const p = parent[mask][cur];
    mask ^= (1 << cur);
    cur = p;
  }

  const order = orderIdx.map((i) => nodes[i]);
  if (mode === 'CYCLE') order.push(nodes[0]);
  return { order, total: bestCost };
}

/**
 * API de alto nivel: dado un grafo (adjacency) y una lista de aeropuertos a
 * visitar (el primero es el origen/base), calcula la ruta optima (TSP) y
 * expande cada tramo con el detalle de escalas via Dijkstra.
 */
function solveTsp(adjacency, airportCodes, mode = 'PATH') {
  const { dist, pathInfo } = effectiveDistanceMatrix(adjacency, airportCodes);
  const result = heldKarpTSP(airportCodes, dist, mode);
  if (!result) return null;
  const detailedLegs = [];
  for (let i = 0; i < result.order.length - 1; i++) {
    const from = result.order[i];
    const to = result.order[i + 1];
    detailedLegs.push({ from, to, cost: dist[from][to], detail: pathInfo[from][to] });
  }
  return { order: result.order, total: result.total, legs: detailedLegs };
}

module.exports = { effectiveDistanceMatrix, heldKarpTSP, solveTsp };
