'use strict';

/* global window, ApiClient, Util, RouteMap, Charts */

window.Views = window.Views || {};

window.Views.flightDashboard = {
  async render(root, { flightId }) {
    const t = window.t;
    await Util.loadAirports();

    root.innerHTML = `
      <h1 class="view-title">${Util.esc(t('dashboardFlight.title'))}</h1>
      <p class="view-subtitle">${Util.esc(t('dashboardFlight.subtitle'))}</p>
      <form id="fd-form" style="display:flex;gap:10px;max-width:520px;margin-bottom:22px">
        <input id="fd-input" placeholder="${Util.esc(t('dashboardFlight.searchPlaceholder'))}" value="${Util.esc(flightId || '')}" style="flex:1">
        <button class="btn btn-primary" type="submit">${Util.esc(t('dashboardFlight.load'))}</button>
      </form>
      <div id="fd-body"></div>`;

    root.querySelector('#fd-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = root.querySelector('#fd-input').value.trim().toUpperCase().replace(/^RP/, 'F-');
      if (id) window.location.hash = `#/dashboard/flight/${id}`;
    });

    if (!flightId) return;
    const body = root.querySelector('#fd-body');
    let first = true;
    // Filtros de la lista de pasajeros (se conservan entre refrescos).
    let sourceFilter = 'ALL';
    let statusFilter = 'BOUGHT';
    let query = '';
    let seats = [];
    const STATUS_GROUPS = { BOUGHT: ['SOLD', 'CHECKED_IN'], RESERVED: ['RESERVED'], ALL: ['SOLD', 'CHECKED_IN', 'RESERVED'] };
    const seatOrder = (a, b) => {
      const [, ra, ca] = a.seatNumber.match(/^(\d+)(\D+)$/) || [];
      const [, rb, cb] = b.seatNumber.match(/^(\d+)(\D+)$/) || [];
      return (Number(ra) - Number(rb)) || String(ca).localeCompare(String(cb));
    };
    const nodeTag = (id) => { const n = ApiClient.nodeById(id); return n ? `${n.flag} ${id.replace(/^NODE_/, '')}` : (id || '—'); };
    const statusText = (s) => t({ SOLD: 'seatLegend.sold', CHECKED_IN: 'seatLegend.checkedIn', RESERVED: 'seatLegend.reserved' }[s] || s);

    // Lista de pasajeros: compras reales (overlay de transacciones) y ocupacion simulada (base del 73 %).
    const drawPassengers = () => {
      const occupied = seats.filter((s) => STATUS_GROUPS.ALL.includes(s.status) && s.passengerName);
      const byStatus = occupied.filter((s) => STATUS_GROUPS[statusFilter].includes(s.status));
      const counts = { ALL: byStatus.length, LIVE: byStatus.filter((s) => s.source === 'LIVE').length, BASE: byStatus.filter((s) => s.source !== 'LIVE').length };
      const q = query.trim().toLowerCase();
      const rows = byStatus
        .filter((s) => sourceFilter === 'ALL' || (sourceFilter === 'LIVE' ? s.source === 'LIVE' : s.source !== 'LIVE'))
        .filter((s) => !q || s.passengerName.toLowerCase().includes(q) || s.seatNumber.toLowerCase().includes(q))
        .sort(seatOrder);
      body.querySelector('#fd-src-chips').innerHTML = [['ALL', 'dashboardFlight.pax.all'], ['LIVE', 'dashboardFlight.pax.real'], ['BASE', 'dashboardFlight.pax.simulated']]
        .map(([key, label]) => `<button type="button" role="radio" class="status-chip" aria-checked="${key === sourceFilter}" data-src="${key}">
          ${Util.esc(t(label))} <span class="mono">${Util.number(counts[key])}</span></button>`).join('');
      body.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => { sourceFilter = b.dataset.src; drawPassengers(); }; });
      body.querySelector('#fd-pax-count').textContent = t('dashboardFlight.pax.showing', { count: Util.number(rows.length) });
      body.querySelector('#fd-pax-body').innerHTML = rows.length ? rows.map((s, i) => {
        const real = s.source === 'LIVE';
        return `<tr class="${real ? 'pax-real' : ''}">
          <td class="num itin-muted">${i + 1}</td>
          <td class="mono" style="font-weight:700">${Util.esc(s.seatNumber)}</td>
          <td><strong>${Util.esc(s.passengerName)}</strong></td>
          <td>${Util.esc(t(s.cabinClass === 'FIRST' ? 'dashboardFlight.firstClass' : 'dashboardFlight.economyClass'))}</td>
          <td><span class="tag ${s.status === 'RESERVED' ? 'tag-pending' : 'tag-synced'}">${Util.esc(statusText(s.status))}</span></td>
          <td>${real ? `<span class="pax-badge real">${Util.esc(t('dashboardFlight.pax.realBadge'))}</span>` : `<span class="pax-badge sim">${Util.esc(t('dashboardFlight.pax.simBadge'))}</span>`}</td>
          <td class="mono" style="font-size:12px">${real ? Util.esc(nodeTag(s.originNode)) : '—'}</td>
          <td>${real ? (s.syncStatus === 'LOCAL_PENDING' ? '<span class="tag tag-pending">⏳</span>' : '<span class="tag tag-synced">✓</span>') : '—'}</td>
          <td class="mono">${real ? s.lamportTs : '—'}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--slate-500);padding:20px">—</td></tr>';
    };

    const draw = async () => {
      let data;
      try {
        data = await ApiClient.get(`/api/admin/dashboard/flight/${flightId}`);
      } catch (err) {
        body.innerHTML = `<div class="banner banner-error">${Util.esc(err.message)}</div>`;
        return;
      }
      const { flight, stats } = data;
      const seatData = await ApiClient.get(`/api/flights/${flightId}/seatmap`);
      const totalSold = stats.FIRST.sold + stats.ECONOMY.sold;
      const totalRes = stats.FIRST.reserved + stats.ECONOMY.reserved;
      const totalAvail = stats.FIRST.available + stats.ECONOMY.available;
      const revenue = stats.FIRST.revenue + stats.ECONOMY.revenue;

      if (first) {
        body.innerHTML = `
          <div class="route-map" style="padding:0;margin-bottom:20px;position:relative">
            <div id="fd-route"></div>
            <div style="position:absolute;left:22px;bottom:16px;color:#fff">
              <div class="mono" style="color:var(--amber-300);font-size:12px">${Util.flightNumber(flight.id)} · ${flight.date} ${flight.time}</div>
              <div style="font-family:var(--font-display);font-size:28px;font-weight:700">${flight.origin} → ${flight.destination}</div>
              <div style="font-size:12.5px;color:#b8c6e2">${Util.esc(flight.aircraftModel)} · ${Util.esc(t('receipt.gate'))} ${Util.esc(flight.gate || '—')} · ${flight.timeHours}h</div>
            </div>
            <div style="position:absolute;right:20px;top:16px" id="fd-status"></div>
          </div>
          <div class="stat-strip" id="fd-stats"></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-bottom:20px">
            <div class="panel"><h3 style="font-size:14px;margin-bottom:10px">${Util.esc(t('dashboardFlight.firstClass'))}</h3><div style="max-width:240px;margin:0 auto"><canvas id="fd-first"></canvas></div></div>
            <div class="panel"><h3 style="font-size:14px;margin-bottom:10px">${Util.esc(t('dashboardFlight.economyClass'))}</h3><div style="max-width:240px;margin:0 auto"><canvas id="fd-econ"></canvas></div></div>
            <div class="panel"><h3 style="font-size:14px;margin-bottom:10px">${Util.esc(t('dashboardFlight.revenue'))} (USD)</h3><canvas id="fd-rev"></canvas></div>
          </div>
          <div class="panel">
            <div class="tickets-head">
              <div><h3 style="font-size:15px;margin:0">${Util.esc(t('dashboardFlight.pax.title'))}</h3>
                <p style="font-size:12.5px;color:var(--slate-500);margin:4px 0 0;max-width:70ch">${Util.esc(t('dashboardFlight.pax.hint'))}</p></div>
              <div class="tickets-controls">
                <select id="fd-status-filter" style="width:auto">
                  <option value="BOUGHT">${Util.esc(t('dashboardFlight.pax.bought'))}</option>
                  <option value="RESERVED">${Util.esc(t('dashboardFlight.pax.reserved'))}</option>
                  <option value="ALL">${Util.esc(t('dashboardFlight.pax.allStatuses'))}</option>
                </select>
                <input type="search" id="fd-pax-q" placeholder="${Util.esc(t('dashboardFlight.pax.search'))}" style="width:200px">
              </div>
            </div>
            <div class="status-chips" id="fd-src-chips" role="radiogroup" style="margin-bottom:10px"></div>
            <div class="boarding-scroll"><table class="data-table report-table">
              <thead><tr><th class="num">#</th><th>${Util.esc(t('receipt.seat'))}</th><th>${Util.esc(t('receipt.passenger'))}</th><th>${Util.esc(t('reports.boarding.cabin'))}</th>
                <th>${Util.esc(t('receipt.statusLabel'))}</th><th>${Util.esc(t('dashboardFlight.pax.type'))}</th><th>${Util.esc(t('dashboardFlight.pax.node'))}</th><th>Sync</th><th>Lamport</th></tr></thead>
              <tbody id="fd-pax-body"></tbody>
            </table></div>
            <div class="report__foot" id="fd-pax-count"></div>
          </div>`;
        body.querySelector('#fd-status-filter').onchange = (e) => { statusFilter = e.target.value; drawPassengers(); };
        body.querySelector('#fd-pax-q').oninput = (e) => { query = e.target.value; drawPassengers(); };
        RouteMap.render(body.querySelector('#fd-route'), {
          routes: [{ from: flight.origin, to: flight.destination }], airports: Util.airportData.airports, showAll: true, caption: 'route',
        });
        first = false;
      }

      body.querySelector('#fd-status').innerHTML = Util.statusBadge(flight.status);
      body.querySelector('#fd-stats').innerHTML = `
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.sold'))}</div><div class="stat-box__value">${Util.number(totalSold)}</div><div class="stat-box__sub">${stats.FIRST.sold} 1ª · ${stats.ECONOMY.sold} T</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.reserved'))}</div><div class="stat-box__value">${Util.number(totalRes)}</div><div class="stat-box__sub">${stats.FIRST.reserved} 1ª · ${stats.ECONOMY.reserved} T</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.available'))}</div><div class="stat-box__value">${Util.number(totalAvail)}</div><div class="stat-box__sub">${stats.FIRST.available} 1ª · ${stats.ECONOMY.available} T</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.revenue'))}</div><div class="stat-box__value amber">${Util.money(revenue)}</div><div class="stat-box__sub">${Util.money(stats.FIRST.revenue)} · ${Util.money(stats.ECONOMY.revenue)}</div></div>`;

      const colors = ['#c23f4a', '#f2a104', '#2f9e74'];
      const labels = [t('dashboardFlight.sold'), t('dashboardFlight.reserved'), t('dashboardFlight.available')];
      Charts.doughnut('fd-first', body.querySelector('#fd-first'), labels, [stats.FIRST.sold, stats.FIRST.reserved, stats.FIRST.available], colors);
      Charts.doughnut('fd-econ', body.querySelector('#fd-econ'), labels, [stats.ECONOMY.sold, stats.ECONOMY.reserved, stats.ECONOMY.available], colors);
      Charts.bar('fd-rev', body.querySelector('#fd-rev'),
        [t('dashboardFlight.firstClass'), t('dashboardFlight.economyClass')],
        [{ label: 'USD', data: [stats.FIRST.revenue, stats.ECONOMY.revenue], backgroundColor: ['#f2a104', '#0b3d91'] }]);

      seats = seatData.seats;
      drawPassengers();
    };

    await draw();
    Util.poll(draw, 4000);
  },
};
