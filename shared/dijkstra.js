'use strict';

/**
 * Dijkstra clasico con min-heap simple (arreglo + busqueda lineal, suficiente
 * para 15 nodos). Devuelve la ruta mas corta (multi-escala si hace falta)
 * entre origin y destination segun el grafo dirigido dado.
 *
 * @param {Object} adjacency  { CODE: [{to, weight}, ...], ... }
 * @param {string} origin
 * @param {string} destination
 * @returns {{ path: string[], legs: {from,to,weight}[], total: number } | null}
 */
function dijkstra(adjacency, origin, destination) {
  const dist = {};
  const prev = {};
  const visited = new Set();
  for (const node of Object.keys(adjacency)) dist[node] = Infinity;
  if (!(origin in adjacency)) return null;
  dist[origin] = 0;

  const queue = new Set(Object.keys(adjacency));

  while (queue.size > 0) {
    // Extraer el nodo no visitado con menor distancia (lineal: ok para N=15)
    let u = null;
    let best = Infinity;
    for (const node of queue) {
      if (dist[node] < best) {
        best = dist[node];
        u = node;
      }
    }
    if (u === null) break; // resto inalcanzable
    queue.delete(u);
    visited.add(u);
    if (u === destination) break;

    for (const edge of adjacency[u] || []) {
      if (visited.has(edge.to)) continue;
      const alt = dist[u] + edge.weight;
      if (alt < dist[edge.to]) {
        dist[edge.to] = alt;
        prev[edge.to] = { node: u, weight: edge.weight };
      }
    }
  }

  if (dist[destination] === undefined || dist[destination] === Infinity) return null;

  // Reconstruir camino
  const path = [destination];
  const legs = [];
  let cur = destination;
  while (cur !== origin) {
    const p = prev[cur];
    if (!p) return null;
    legs.unshift({ from: p.node, to: cur, weight: p.weight });
    path.unshift(p.node);
    cur = p.node;
  }

  return { path, legs, total: dist[destination] };
}

module.exports = { dijkstra };
