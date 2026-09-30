'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dijkstra } = require('../shared/dijkstra');
const pricing = require('../shared/pricing');

test('Dijkstra calcula rutas consistentes para precio y tiempo', () => {
  for (const kind of ['ECONOMY', 'FIRST', 'TIME']) {
    const result = dijkstra(pricing.graphFor(kind), 'LAX', 'SAO');
    assert.ok(result);
    assert.equal(result.path[0], 'LAX');
    assert.equal(result.path.at(-1), 'SAO');
    assert.equal(result.total, result.legs.reduce((sum, leg) => sum + leg.weight, 0));
  }
});

test('Dijkstra devuelve null cuando no existe camino', () => {
  assert.equal(dijkstra({ A: [], B: [] }, 'A', 'B'), null);
});

test('Dijkstra matches independent all-pairs shortest paths for all matrices', () => {
  for (const kind of ['ECONOMY', 'FIRST', 'TIME']) {
    const graph = pricing.graphFor(kind);
    const nodes = Object.keys(graph);
    const distances = Object.fromEntries(nodes.map(a => [a, Object.fromEntries(nodes.map(b => [b, a === b ? 0 : Infinity]))]));
    for (const a of nodes) for (const edge of graph[a]) distances[a][edge.to] = Math.min(distances[a][edge.to], edge.weight);
    for (const k of nodes) for (const a of nodes) for (const b of nodes) distances[a][b] = Math.min(distances[a][b], distances[a][k] + distances[k][b]);
    for (const a of nodes) for (const b of nodes) assert.equal(dijkstra(graph, a, b)?.total ?? Infinity, distances[a][b], `${kind}: ${a} -> ${b}`);
  }
});
