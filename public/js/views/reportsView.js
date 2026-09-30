'use strict';

/* global window, ApiClient, Util */

window.Views = window.Views || {};

/** Reportes pedidos por el ingeniero (puntos extra), calculados con los datos reales del sistema. */
window.Views.reports = {
  async render(root) {
    const t = window.t;
    await Util.loadAirports();
    const aircraft = await ApiClient.get('/api/aircraft');

    root.innerHTML = `
      <h1 class="view-title" style="margin-bottom:4px">${Util.esc(t('reports.title'))}</h1>
      <p class="itin-sub" style="margin:0 0 22px">${Util.esc(t('reports.subtitle'))}</p>

      <section class="panel report">
        <div class="report__head"><span class="report__num">1</span>
          <div><h2>${Util.esc(t('reports.conn.title'))}</h2><p>${Util.esc(t('reports.conn.question'))}</p></div></div>
        <div class="report__criteria">${Util.esc(t('reports.conn.criteria'))}</div>
        <div style="overflow-x:auto"><table class="data-table report-table">
          <thead><tr>
            <th>${Util.esc(t('reports.conn.server'))}</th>
            <th class="num">${Util.esc(t('reports.conn.connections'))}</th>
            <th class="num">${Util.esc(t('reports.conn.purchaseConnections'))}</th>
            <th class="num">${Util.esc(t('reports.conn.clients'))}</th>
            <th class="num">${Util.esc(t('reports.conn.purchaseRequests'))}</th>
            <th class="num">${Util.esc(t('reports.conn.ticketsSold'))}</th>
            <th class="num">${Util.esc(t('reports.conn.dbRecords'))}</th>
            <th class="num">${Util.esc(t('reports.conn.activeNow'))}</th>
          </tr></thead>
          <tbody id="rc-body"></tbody>
        </table></div>
        <div class="report__foot" id="rc-foot"></div>
      </section>

      <section class="panel report">
        <div class="report__head"><span class="report__num">2</span>
          <div><h2>${Util.esc(t('reports.boarding.title'))}</h2><p>${Util.esc(t('reports.boarding.question'))}</p></div></div>
        <form class="report__search" id="rb-form">
          <div class="field" style="margin:0"><label for="rb-code">${Util.esc(t('reports.boarding.code'))}</label>
            <input id="rb-code" placeholder="RP000625" autocomplete="off" style="width:180px"></div>
          <button class="btn btn-primary" type="submit">${Util.esc(t('reports.boarding.show'))}</button>
          <button class="btn btn-ghost" type="button" id="rb-print" hidden>🖨 ${Util.esc(t('reports.boarding.print'))}</button>
        </form>
        <div class="report__chips" id="rb-chips"></div>
        <div id="rb-result"></div>
      </section>

      <section class="panel report">
        <div class="report__head"><span class="report__num">3</span>
          <div><h2>${Util.esc(t('reports.fleet.title'))}</h2><p>${Util.esc(t('reports.fleet.question'))}</p></div></div>
        <div id="rf-result"></div>
      </section>`;

    // ---------------- 1) Conexiones por servidor (se consulta a cada nodo) ----------------
    const drawConnections = async () => {
      const nodes = ApiClient.nodes();
      const results = await Promise.allSettled(nodes.map((n) => ApiClient.get('/api/reports/connections', null, n.url)));
      const n0 = (v) => (v === null || v === undefined ? '—' : Util.number(v));
      const totals = { connections: 0, purchaseConnections: 0, clients: 0, purchaseRequests: 0, ticketsSoldHere: 0, dbRecords: 0, activeNow: 0 };
      const rows = nodes.map((n, i) => {
        const r = results[i];
        if (r.status !== 'fulfilled') {
          return `<tr><td><strong>${Util.esc(n.flag)} ${Util.esc(n.label)}</strong><div class="itin-muted mono">${Util.esc(n.url)}</div></td>
            <td colspan="7" style="color:var(--rose-600)">${Util.esc(t('dashboardGlobal.unreachable'))}</td></tr>`;
        }
        const s = r.value;
        Object.keys(totals).forEach((k) => { totals[k] += Number(s[k]) || 0; });
        return `<tr>
          <td><strong>${Util.esc(n.flag)} ${Util.esc(n.label)}</strong><div class="itin-muted mono">${Util.esc(n.url)} · ${Util.esc(s.dbDriver)}</div></td>
          <td class="num big">${n0(s.connections)}</td>
          <td class="num big">${n0(s.purchaseConnections)}</td>
          <td class="num">${n0(s.clients)}</td>
          <td class="num">${n0(s.purchaseRequests)}</td>
          <td class="num">${n0(s.ticketsSoldHere)}</td>
          <td class="num">${n0(s.dbRecords)}</td>
          <td class="num">${n0(s.activeNow)}</td>
        </tr>`;
      });
      rows.push(`<tr class="total"><td>${Util.esc(t('reports.total'))}</td>
        <td class="num big">${Util.number(totals.connections)}</td><td class="num big">${Util.number(totals.purchaseConnections)}</td>
        <td class="num">${Util.number(totals.clients)}</td><td class="num">${Util.number(totals.purchaseRequests)}</td>
        <td class="num">${Util.number(totals.ticketsSoldHere)}</td><td class="num">${Util.number(totals.dbRecords)}</td>
        <td class="num">${Util.number(totals.activeNow)}</td></tr>`);
      root.querySelector('#rc-body').innerHTML = rows.join('');
      root.querySelector('#rc-foot').textContent = t('reports.updated', { time: new Date().toLocaleTimeString(window.I18n.lang) });
    };

    // ---------------- 2) Lista de embarque de un vuelo ----------------
    const resultEl = root.querySelector('#rb-result');
    const printBtn = root.querySelector('#rb-print');
    const toFlightId = (code) => {
      const m = String(code || '').trim().toUpperCase().match(/^(?:RP|F-?)?0*(\d{1,6})$/);
      return m ? `F-${m[1].padStart(6, '0')}` : null;
    };
    const seatOrder = (a, b) => {
      const [, ra, ca] = a.seatNumber.match(/^(\d+)(\D+)$/) || [];
      const [, rb, cb] = b.seatNumber.match(/^(\d+)(\D+)$/) || [];
      return (Number(ra) - Number(rb)) || String(ca).localeCompare(String(cb));
    };

    const showBoarding = async (code) => {
      const flightId = toFlightId(code);
      if (!flightId) { resultEl.innerHTML = `<div class="banner banner-warn">${Util.esc(t('reports.boarding.badCode'))}</div>`; printBtn.hidden = true; return; }
      root.querySelector('#rb-code').value = Util.flightNumber(flightId);
      resultEl.innerHTML = `<p class="itin-muted">${Util.esc(t('common.loading'))}</p>`;
      let data;
      try { data = await ApiClient.get(`/api/flights/${flightId}/seatmap`); } catch {
        resultEl.innerHTML = `<div class="banner banner-warn">${Util.esc(t('reports.boarding.notFound', { code: Util.flightNumber(flightId) }))}</div>`;
        printBtn.hidden = true;
        return;
      }
      const { flight, seats } = data;
      const boarding = seats.filter((s) => ['SOLD', 'CHECKED_IN'].includes(s.status) && s.passengerName).sort(seatOrder);
      const checkedIn = boarding.filter((s) => s.status === 'CHECKED_IN').length;
      const live = boarding.filter((s) => s.source === 'LIVE').length;
      const model = aircraft.models[flight.aircraftModel] ? aircraft.models[flight.aircraftModel].name : flight.aircraftModel;
      resultEl.innerHTML = `
        <div class="boarding-head">
          <div><div class="mono" style="font-size:22px;font-weight:700">${Util.flightNumber(flight.id)} · ${flight.origin} → ${flight.destination}</div>
            <div class="itin-muted">${Util.esc(Util.airportLabel(flight.origin))} → ${Util.esc(Util.airportLabel(flight.destination))} · ${flight.date} ${flight.time} · ${Util.esc(model)} (#${flight.aircraftId}) · ${Util.esc(t('statusBoard.gate'))} ${Util.esc(flight.gate || '—')}</div></div>
          <div class="boarding-stats">
            <div><strong>${Util.number(boarding.length)}</strong><span>${Util.esc(t('reports.boarding.passengers'))}</span></div>
            <div><strong>${Util.number(checkedIn)}</strong><span>${Util.esc(t('seatLegend.checkedIn'))}</span></div>
            <div><strong>${Util.number(live)}</strong><span>${Util.esc(t('reports.boarding.realPurchases'))}</span></div>
          </div>
        </div>
        <div class="report__search" style="margin:12px 0">
          <input type="search" id="rb-filter" placeholder="${Util.esc(t('reports.boarding.filter'))}" style="max-width:280px">
          <label style="display:flex;gap:6px;align-items:center;margin:0;font-size:13.5px;white-space:nowrap"><input type="checkbox" id="rb-live" style="width:auto"> ${Util.esc(t('reports.boarding.onlyLive'))}</label>
        </div>
        <div class="boarding-scroll"><table class="data-table report-table" id="rb-table">
          <thead><tr><th class="num">#</th><th>${Util.esc(t('reports.boarding.name'))}</th><th>${Util.esc(t('reports.boarding.seat'))}</th>
            <th>${Util.esc(t('reports.boarding.cabin'))}</th><th>${Util.esc(t('receipt.statusLabel'))}</th><th>${Util.esc(t('reports.boarding.source'))}</th></tr></thead>
          <tbody>${boarding.map((s, i) => `<tr data-name="${Util.esc(s.passengerName.toLowerCase())}" data-live="${s.source === 'LIVE'}">
            <td class="num itin-muted">${i + 1}</td><td><strong>${Util.esc(s.passengerName)}</strong></td><td class="mono big">${Util.esc(s.seatNumber)}</td>
            <td>${Util.esc(t(s.cabinClass === 'FIRST' ? 'reports.boarding.first' : 'reports.boarding.economy'))}</td>
            <td><span class="tag ${s.status === 'CHECKED_IN' ? 'tag-synced' : 'tag-pending'}">${Util.esc(t(s.status === 'CHECKED_IN' ? 'seatLegend.checkedIn' : 'seatLegend.sold'))}</span></td>
            <td class="itin-muted">${Util.esc(t(s.source === 'LIVE' ? 'reports.boarding.sourceLive' : 'reports.boarding.sourceBase'))}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="itin-note">${Util.esc(t('reports.boarding.note'))}</p>`;
      printBtn.hidden = false;
      const applyFilter = () => {
        const q = resultEl.querySelector('#rb-filter').value.trim().toLowerCase();
        const onlyLive = resultEl.querySelector('#rb-live').checked;
        resultEl.querySelectorAll('#rb-table tbody tr').forEach((tr) => {
          tr.hidden = (q && !tr.dataset.name.includes(q)) || (onlyLive && tr.dataset.live !== 'true');
        });
      };
      resultEl.querySelector('#rb-filter').oninput = applyFilter;
      resultEl.querySelector('#rb-live').onchange = applyFilter;
    };

    root.querySelector('#rb-form').onsubmit = (e) => { e.preventDefault(); showBoarding(root.querySelector('#rb-code').value); };
    printBtn.onclick = () => window.print();

    const drawChips = async () => {
      try {
        const { flights } = await ApiClient.get('/api/reports/boarding-flights');
        root.querySelector('#rb-chips').innerHTML = flights.length
          ? `<span class="itin-muted">${Util.esc(t('reports.boarding.withPurchases'))}</span> ` + flights.map((f) =>
            `<button type="button" class="status-chip" data-flight="${Util.esc(f.flightId)}">${Util.flightNumber(f.flightId)} · ${f.origin}→${f.destination} <span class="mono">${f.tickets}</span></button>`).join('')
          : '';
        root.querySelectorAll('[data-flight]').forEach((b) => { b.onclick = () => showBoarding(b.dataset.flight); });
        return flights;
      } catch { return []; }
    };

    // ---------------- 3) Avion de mayor capacidad ----------------
    const drawFleet = async () => {
      const { aircraft: fleet, maxTotal } = await ApiClient.get('/api/reports/fleet');
      const top = fleet.filter((a) => a.total === maxTotal);
      const models = [...new Set(fleet.map((a) => a.model))].map((m) => fleet.find((a) => a.model === m));
      const winner = top[0];
      root.querySelector('#rf-result').innerHTML = `
        <div class="fleet-winner">
          <div class="fleet-winner__icon">✈</div>
          <div>
            <div class="itin-muted">${Util.esc(t('reports.fleet.answer'))}</div>
            <div class="fleet-winner__name">${Util.esc(winner.modelName)}</div>
            <div class="fleet-winner__ids">${Util.esc(t('reports.fleet.units', { count: top.length, ids: top.map((a) => `#${a.aircraftId}`).join(', ') }))}</div>
          </div>
          <div class="fleet-winner__caps">
            <div><strong>${winner.firstClass}</strong><span>${Util.esc(t('reports.fleet.business'))}</span></div>
            <div><strong>${winner.economy}</strong><span>${Util.esc(t('reports.fleet.economy'))}</span></div>
            <div class="total"><strong>${winner.total}</strong><span>${Util.esc(t('reports.fleet.total'))}</span></div>
          </div>
        </div>
        <h3 style="font-size:14px;margin:18px 0 8px">${Util.esc(t('reports.fleet.byModel'))}</h3>
        <div style="overflow-x:auto"><table class="data-table report-table">
          <thead><tr><th>${Util.esc(t('reports.fleet.model'))}</th><th class="num">${Util.esc(t('reports.fleet.business'))}</th><th class="num">${Util.esc(t('reports.fleet.economy'))}</th>
            <th class="num">${Util.esc(t('reports.fleet.total'))}</th><th class="num">${Util.esc(t('reports.fleet.fleetSize'))}</th></tr></thead>
          <tbody>${models.map((m) => `<tr class="${m.total === maxTotal ? 'winner' : ''}"><td><strong>${Util.esc(m.modelName)}</strong></td>
            <td class="num">${m.firstClass}</td><td class="num">${m.economy}</td><td class="num big">${m.total}</td>
            <td class="num">${fleet.filter((a) => a.model === m.model).length}</td></tr>`).join('')}</tbody>
        </table></div>
        <details style="margin-top:14px"><summary style="cursor:pointer;font-weight:600;font-size:14px">${Util.esc(t('reports.fleet.allAircraft', { count: fleet.length }))}</summary>
          <div class="boarding-scroll" style="margin-top:10px"><table class="data-table report-table">
            <thead><tr><th>${Util.esc(t('reports.fleet.registration'))}</th><th>${Util.esc(t('reports.fleet.model'))}</th><th class="num">${Util.esc(t('reports.fleet.business'))}</th>
              <th class="num">${Util.esc(t('reports.fleet.economy'))}</th><th class="num">${Util.esc(t('reports.fleet.total'))}</th><th class="num">${Util.esc(t('reports.fleet.flights'))}</th></tr></thead>
            <tbody>${fleet.map((a) => `<tr class="${a.total === maxTotal ? 'winner' : ''}"><td class="mono"><strong>#${a.aircraftId}</strong></td><td>${Util.esc(a.modelName)}</td>
              <td class="num">${a.firstClass}</td><td class="num">${a.economy}</td><td class="num big">${a.total}</td><td class="num">${Util.number(a.flights)}</td></tr>`).join('')}</tbody>
          </table></div></details>
        <p class="itin-note">${Util.esc(t('reports.fleet.note'))}</p>`;
    };

    await Promise.all([drawConnections(), drawFleet()]);
    const withPurchases = await drawChips();
    if (withPurchases.length) showBoarding(withPurchases[0].flightId);
    Util.poll(drawConnections, 5000);
  },
};
