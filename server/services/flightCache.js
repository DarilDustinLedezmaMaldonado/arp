'use strict';

// Reglas de conexion (1 escala): tiempo minimo para cambiar de avion y espera maxima razonable.
const MIN_LAYOVER_MIN = 60;
const MAX_LAYOVER_MIN = 24 * 60;
const departureMs = (f) => Date.parse(`${f.date}T${f.time}:00Z`);
const arrivalMs = (f) => departureMs(f) + (Number(f.timeHours) || 0) * 3600000;

/** Minutos de escala entre dos vuelos, o null si el segundo no sirve como conexion del primero. */
function layoverMinutes(first, second, { minLayoverMin = MIN_LAYOVER_MIN, maxLayoverMin = MAX_LAYOVER_MIN } = {}) {
  if (!first || !second || first.destination !== second.origin) return null;
  const minutes = Math.round((departureMs(second) - arrivalMs(first)) / 60000);
  return minutes >= minLayoverMin && minutes <= maxLayoverMin ? minutes : null;
}

class FlightCache {
  constructor(primaryAdapter) {
    this.primaryAdapter = primaryAdapter;
    this.byId = new Map();
  }

  async load() {
    const BATCH = 5000;
    let offset = 0;
    this.byId.clear();
    for (;;) {
      const rows = await this.primaryAdapter.listFlights({ limit: BATCH, offset });
      for (const f of rows) this.byId.set(f.id, f);
      if (rows.length < BATCH) break;
      offset += BATCH;
    }
    return this.byId.size;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  search({ origin, destination, dateFrom, dateTo, status, sort = 'DEPARTURE', limit = 50, offset = 0 }) {
    let rows = Array.from(this.byId.values());
    if (origin) rows = rows.filter((f) => f.origin === origin);
    if (destination) rows = rows.filter((f) => f.destination === destination);
    if (dateFrom) rows = rows.filter((f) => f.date >= dateFrom);
    if (dateTo) rows = rows.filter((f) => f.date <= dateTo);
    if (status) rows = rows.filter((f) => f.status === status);
    const byDeparture = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
    if (sort === 'PRICE_ASC') {
      rows.sort((a, b) => (Number(a.priceEconomy) || Infinity) - (Number(b.priceEconomy) || Infinity) || byDeparture(a, b));
    } else if (sort === 'DURATION_ASC') {
      rows.sort((a, b) => (Number(a.timeHours) || Infinity) - (Number(b.timeHours) || Infinity) || byDeparture(a, b));
    } else {
      rows.sort(byDeparture);
    }
    const total = rows.length;
    return { total, rows: rows.slice(offset, offset + limit) };
  }

  /** Dias con vuelos (YYYY-MM-DD) y cuantos hay, opcionalmente para una ruta. */
  dates({ origin, destination } = {}) {
    const counts = new Map();
    for (const f of this.byId.values()) {
      if (origin && f.origin !== origin) continue;
      if (destination && f.destination !== destination) continue;
      counts.set(f.date, (counts.get(f.date) || 0) + 1);
    }
    return Array.from(counts, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Itinerarios con 1 escala hechos de vuelos reales: el segundo tramo sale del aeropuerto de escala
   * entre minLayoverMin y maxLayoverMin despues de que aterriza el primero. Por cada primer tramo
   * se toma la conexion mas temprana; se ordenan por duracion total (o precio).
   */
  connections({ origin, destination, date, dateFrom, sort = 'DURATION_ASC', limit = 10, minLayoverMin = MIN_LAYOVER_MIN, maxLayoverMin = MAX_LAYOVER_MIN } = {}) {
    if (!origin || !destination || origin === destination) return { total: 0, rows: [] };
    const at = departureMs;
    const arrival = arrivalMs;

    const firstLegs = [];
    const secondByHub = new Map();
    for (const f of this.byId.values()) {
      if (f.origin === origin && f.destination !== destination && (!date || f.date === date) && (!dateFrom || f.date >= dateFrom)) firstLegs.push(f);
      if (f.destination === destination && f.origin !== origin) {
        if (!secondByHub.has(f.origin)) secondByHub.set(f.origin, []);
        secondByHub.get(f.origin).push(f);
      }
    }
    for (const list of secondByHub.values()) list.sort((a, b) => at(a) - at(b));

    const rows = [];
    for (const first of firstLegs) {
      const candidates = secondByHub.get(first.destination);
      if (!candidates) continue;
      const earliest = arrival(first) + minLayoverMin * 60000;
      const latest = arrival(first) + maxLayoverMin * 60000;
      // Busqueda binaria del primer vuelo que sale despues del tiempo minimo de escala.
      let lo = 0;
      let hi = candidates.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (at(candidates[mid]) < earliest) lo = mid + 1; else hi = mid; }
      const second = candidates[lo];
      if (!second || at(second) > latest) continue;
      rows.push({
        hub: first.destination,
        legs: [first, second],
        layoverMinutes: Math.round((at(second) - arrival(first)) / 60000),
        totalMinutes: Math.round((arrival(second) - at(first)) / 60000),
        priceEconomy: (Number(first.priceEconomy) || 0) + (Number(second.priceEconomy) || 0),
      });
    }
    const byDuration = (a, b) => a.totalMinutes - b.totalMinutes || a.priceEconomy - b.priceEconomy;
    const byPrice = (a, b) => a.priceEconomy - b.priceEconomy || a.totalMinutes - b.totalMinutes;
    const byDeparture = (a, b) => at(a.legs[0]) - at(b.legs[0]) || a.totalMinutes - b.totalMinutes;
    rows.sort(sort === 'PRICE_ASC' ? byPrice : sort === 'DEPARTURE' ? byDeparture : byDuration);
    return { total: rows.length, rows: rows.slice(0, limit) };
  }

  all() {
    return Array.from(this.byId.values());
  }
}

module.exports = { FlightCache, layoverMinutes, MIN_LAYOVER_MIN, MAX_LAYOVER_MIN };
