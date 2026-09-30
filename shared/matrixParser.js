'use strict';

const AIRPORT_ORDER = require('../config/airports.json').order;

/**
 * Convierte texto pegado desde Excel (separado por tabs, con encabezados de
 * fila y columna con codigos de aeropuerto, ej "ATL (USA)" o solo "ATL") en
 * una matriz 15x15 en el mismo `order` que usa el resto del sistema.
 * Acepta celdas vacias (sin ruta), "0" (sin ruta / mismo aeropuerto) y
 * numeros con comas de miles ("1,456").
 */
function parsePastedMatrix(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\n$/, ''))
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error('El texto pegado no tiene suficientes filas (se esperaban encabezado + 15 filas).');
  }

  const headerCells = lines[0].split('\t').map((c) => c.trim());
  // la primera celda del encabezado suele estar vacia (esquina superior izq.)
  const colCodes = headerCells
    .map(extractAirportCode)
    .filter((c) => c !== null);

  const dataLines = lines.slice(1);
  const rowCodes = [];
  const rawRows = [];
  for (const line of dataLines) {
    const cells = line.split('\t');
    const rowCode = extractAirportCode(cells[0]);
    if (!rowCode) continue;
    rowCodes.push(rowCode);
    rawRows.push(cells.slice(1));
  }

  if (colCodes.length !== 15 || rowCodes.length !== 15) {
    throw new Error(
      `Se esperaban 15 columnas y 15 filas de aeropuertos. Se encontraron ${colCodes.length} columnas y ${rowCodes.length} filas.`
    );
  }
  for (const code of AIRPORT_ORDER) {
    if (!colCodes.includes(code)) throw new Error(`Falta la columna del aeropuerto ${code}`);
    if (!rowCodes.includes(code)) throw new Error(`Falta la fila del aeropuerto ${code}`);
  }

  // Reordenar a AIRPORT_ORDER sin importar el orden en que vino el pegado
  const matrix = AIRPORT_ORDER.map((rowCode) => {
    const rIdx = rowCodes.indexOf(rowCode);
    return AIRPORT_ORDER.map((colCode) => {
      const cIdx = colCodes.indexOf(colCode);
      const raw = (rawRows[rIdx][cIdx] || '').trim();
      if (rowCode === colCode) return 0;
      if (raw === '' || raw === '0') return null;
      const num = Number(raw.replace(/,/g, ''));
      if (Number.isNaN(num)) throw new Error(`Valor invalido "${raw}" en ${rowCode}->${colCode}`);
      return num;
    });
  });

  return { order: AIRPORT_ORDER, matrix };
}

function extractAirportCode(cell) {
  if (!cell) return null;
  const m = cell.trim().match(/^([A-Z]{3})/);
  return m ? m[1] : null;
}

/** Convierte una matriz interna de vuelta a TSV para exportar/copiar a Excel. */
function matrixToTsv(order, matrix, airportsMeta) {
  const header = ['', ...order.map((c) => `${c}${airportsMeta ? ` (${airportsMeta[c].countryCode})` : ''}`)].join('\t');
  const rows = order.map((rowCode, i) => {
    const cells = order.map((colCode, j) => {
      if (i === j) return '0';
      const v = matrix[i][j];
      return v === null ? '' : String(v);
    });
    return [`${rowCode}${airportsMeta ? ` (${airportsMeta[rowCode].countryCode})` : ''}`, ...cells].join('\t');
  });
  return [header, ...rows].join('\n');
}

module.exports = { parsePastedMatrix, matrixToTsv, extractAirportCode };
