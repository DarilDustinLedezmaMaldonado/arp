'use strict';

/**
 * Copia a public/vendor las librerias de terceros y las fuentes que la
 * interfaz usa, para que la app funcione sin internet dentro de la LAN del
 * salon (solo depende de tener los otros 2 nodos alcanzables). Se corre una
 * vez despues de `npm install` (ya viene resuelto en el repo, pero si
 * actualizas versiones corre `npm run vendor:assets` de nuevo).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'public', 'vendor');
const FONTS = path.join(VENDOR, 'fonts');
fs.mkdirSync(FONTS, { recursive: true });

function copy(src, dest) {
  fs.copyFileSync(src, dest);
  console.log('  ->', path.relative(ROOT, dest));
}

console.log('Copiando Chart.js y html5-qrcode...');
copy(path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), path.join(VENDOR, 'chart.umd.js'));
copy(path.join(ROOT, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'), path.join(VENDOR, 'html5-qrcode.min.js'));

console.log('Copiando fuentes...');
const fontFiles = [
  ['space-grotesk', 500], ['space-grotesk', 600], ['space-grotesk', 700],
  ['inter', 400], ['inter', 500], ['inter', 600], ['inter', 700],
  ['jetbrains-mono', 500], ['jetbrains-mono', 600], ['jetbrains-mono', 700],
];
for (const [family, weight] of fontFiles) {
  const file = `${family}-latin-${weight}-normal.woff2`;
  copy(path.join(ROOT, 'node_modules', '@fontsource', family, 'files', file), path.join(FONTS, file));
}

console.log('Generando mapa del mundo (Natural Earth 1:110m, dominio publico)...');
{
  const topojson = require('topojson-client');
  const world = require('world-atlas/countries-110m.json');
  const round = (n) => Math.round(n * 10) / 10;
  const clean = (line) => line.map(([x, y]) => [round(x), round(y)])
    .filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]);
  // Tierra firme como anillos de poligonos y fronteras entre paises como lineas.
  const land = topojson.feature(world, world.objects.land);
  const rings = [];
  for (const f of land.features || [land]) {
    const g = f.geometry || f;
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const ring of poly) rings.push(clean(ring));
  }
  const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
  const lines = (borders.type === 'MultiLineString' ? borders.coordinates : [borders.coordinates]).map(clean);
  const dest = path.join(VENDOR, 'world-110m.json');
  fs.writeFileSync(dest, JSON.stringify({ source: 'Natural Earth 1:110m via world-atlas', rings, lines }));
  console.log('  ->', path.relative(ROOT, dest));
}

console.log('Listo. Si agregaste pesos/familias nuevas, actualiza tambien public/css/main.css (@font-face).');
