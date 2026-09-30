'use strict';

/* global window, navigator, localStorage */

const LS_COUNTRY = 'arp_country';

// País desde el que "compra" el usuario -> nodo más cercano y idioma de la interfaz.
// Nodos: NODE_NA (Norte y Centroamérica), NODE_SA (Sudamérica) y NODE_EA (Europa, Asia,
// Medio Oriente, África y Oceanía: todos más cerca del nodo Europa/Asia que de los otros dos).
// Idiomas disponibles: es, en, pt, zh, fr; los demás países usan inglés.
const COUNTRY_GROUPS = [
  { key: 'northCentral', node: 'NODE_NA', countries: {
    US: 'en', CA: 'en', MX: 'es', GT: 'es', SV: 'es', HN: 'es', NI: 'es', CR: 'es', PA: 'es', CU: 'es', DO: 'es', PR: 'es', JM: 'en' } },
  { key: 'south', node: 'NODE_SA', countries: {
    AR: 'es', BO: 'es', BR: 'pt', CL: 'es', CO: 'es', EC: 'es', PY: 'es', PE: 'es', UY: 'es', VE: 'es' } },
  { key: 'europe', node: 'NODE_EA', countries: {
    ES: 'es', PT: 'pt', FR: 'fr', BE: 'fr', GB: 'en', IE: 'en', DE: 'en', IT: 'en', NL: 'en', PL: 'en', TR: 'en' } },
  { key: 'asia', node: 'NODE_EA', countries: {
    CN: 'zh', HK: 'zh', TW: 'zh', JP: 'en', KR: 'en', SG: 'en', IN: 'en', TH: 'en', AE: 'en', SA: 'en' } },
  { key: 'africa', node: 'NODE_EA', countries: { ZA: 'en', EG: 'en', MA: 'fr', SN: 'fr', NG: 'en', AO: 'pt' } },
  { key: 'oceania', node: 'NODE_EA', countries: { AU: 'en', NZ: 'en' } },
];

// Si el navegador no dice el país, se usa uno de la región del nodo que sirvió la página.
const DEFAULT_BY_NODE = { NODE_NA: 'US', NODE_EA: 'ES', NODE_SA: 'BO' };

const Countries = {
  code: null,

  groups() { return COUNTRY_GROUPS; },

  info(code) {
    for (const g of COUNTRY_GROUPS) if (g.countries[code]) return { code, node: g.node, lang: g.countries[code], group: g.key };
    return null;
  },

  flag(code) {
    return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  },

  name(code, lang) {
    try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch { return code; }
  },

  /** País guardado; si es la primera visita, se adivina por el idioma del navegador (es-BO -> BO). */
  init(selfNodeId) {
    let saved = null;
    try { saved = localStorage.getItem(LS_COUNTRY); } catch { /* sin almacenamiento */ }
    if (saved && this.info(saved)) { this.code = saved; return { code: saved, firstVisit: false }; }
    const fromBrowser = (navigator.languages || [navigator.language || ''])
      .map((l) => (l.split('-')[1] || '').toUpperCase())
      .find((c) => this.info(c));
    this.code = fromBrowser || DEFAULT_BY_NODE[selfNodeId] || 'US';
    return { code: this.code, firstVisit: true };
  },

  set(code) {
    this.code = code;
    try { localStorage.setItem(LS_COUNTRY, code); } catch { /* sin almacenamiento */ }
  },
};

window.Countries = Countries;
