'use strict';

const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'airports.json'), 'utf-8'));

function regionOf(code) {
  const a = data.airports[code];
  if (!a) throw new Error(`Aeropuerto desconocido: ${code}`);
  return a.region;
}

/** El nodo DUENO de un vuelo se determina por la region del aeropuerto DESTINO. */
function ownerNodeForFlight(origin, destination) {
  return regionOf(destination);
}

module.exports = {
  order: data.order,
  airports: data.airports,
  regionOf,
  ownerNodeForFlight,
};
