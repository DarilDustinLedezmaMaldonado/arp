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

console.log('Listo. Si agregaste pesos/familias nuevas, actualiza tambien public/css/main.css (@font-face).');
