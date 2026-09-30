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
      const live = seatData.seats.filter((s) => s.source === 'LIVE');
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
          <div class="panel"><h3 style="font-size:14px;margin-bottom:10px"><span id="fd-live-count"></span> ${Util.esc(t('dashboardFlight.liveCount'))}</h3><div id="fd-live"></div></div>`;
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

      body.querySelector('#fd-live-count').textContent = live.length;
      body.querySelector('#fd-live').innerHTML = live.length === 0 ? '<span style="color:var(--slate-400);font-size:13px">—</span>' : `
        <table class="data-table"><thead><tr><th>${Util.esc(t('receipt.seat'))}</th><th>${Util.esc(t('receipt.passenger'))}</th><th>${Util.esc(t('receipt.statusLabel'))}</th><th>Sync</th><th>Origen</th><th>Lamport</th></tr></thead><tbody>
        ${live.map((s) => `<tr><td class="mono">${s.seatNumber}</td><td>${Util.esc(s.passengerName || '—')}</td><td>${Util.esc(s.status)}</td>
          <td>${s.syncStatus === 'LOCAL_PENDING' ? '<span class="tag tag-pending">⏳ pending</span>' : '<span class="tag tag-synced">✓ synced</span>'}</td>
          <td class="mono" style="font-size:12px">${Util.esc(s.originNode)}</td><td class="mono">${s.lamportTs}</td></tr>`).join('')}
        </tbody></table>`;
    };

    await draw();
    Util.poll(draw, 4000);
  },
};
