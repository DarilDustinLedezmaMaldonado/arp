'use strict';

/* global window, document, ApiClient */

const LS_TICKETS = 'arp_my_tickets';

const Util = {
  airportData: null,

  esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  money(n) {
    if (n === null || n === undefined) return '—';
    return new Intl.NumberFormat(window.I18n ? window.I18n.lang : 'es', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  },

  number(n) {
    return new Intl.NumberFormat(window.I18n ? window.I18n.lang : 'es').format(n);
  },

  async loadAirports() {
    if (!this.airportData) this.airportData = await ApiClient.get('/api/airports');
    return this.airportData;
  },

  airport(code) {
    return this.airportData && this.airportData.airports[code];
  },

  /** "LON · Londres" */
  airportLabel(code) {
    const a = this.airport(code);
    return a ? `${code} · ${a.city}` : code;
  },

  statusBadge(status) {
    return `<span class="status-badge ${this.esc(status)}">${this.esc(window.t('flightStatus.' + status))}</span>`;
  },

  flightNumber(flightId) {
    return String(flightId).replace('F-', 'RP');
  },

  toast(message, type = 'ok') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:8px;z-index:100;';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    const colors = { ok: '#1f8a5c', error: '#c23f4a', warn: '#b3760a' };
    el.style.cssText = `background:${colors[type] || colors.ok};color:#fff;padding:12px 16px;border-radius:8px;font-size:13.5px;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,.25);`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  },

  // ---- "Mis boletos": como no hay login, el navegador recuerda los txId que compro ----
  myTickets: {
    list() { return JSON.parse(localStorage.getItem(LS_TICKETS) || '[]'); },
    add(entry) {
      const all = this.list().filter((e) => e.txId !== entry.txId);
      all.unshift(entry);
      localStorage.setItem(LS_TICKETS, JSON.stringify(all.slice(0, 30)));
    },
    remove(txId) {
      localStorage.setItem(LS_TICKETS, JSON.stringify(this.list().filter((e) => e.txId !== txId)));
    },
  },

  /** Ejecuta fn cada ms milisegundos mientras la vista siga montada. Devuelve stop(). */
  poll(fn, ms) {
    const id = setInterval(() => { fn().catch(() => {}); }, ms);
    Util._pollers.push(id);
    return () => clearInterval(id);
  },
  _pollers: [],
  stopAllPollers() { Util._pollers.forEach(clearInterval); Util._pollers = []; },
};

window.Util = Util;
