'use strict';

/* global window, ApiClient, Util, RouteMap */

window.Views = window.Views || {};

window.Views.planner = {
  async render(root) {
    const t = window.t;
    const { order, airports } = await Util.loadAirports();
    const airportOpts = order.map((c) => `<option value="${c}">${Util.esc(c + ' · ' + airports[c].city)}</option>`).join('');
    const weightOpts = `
      <option value="ECONOMY">${Util.esc(t('routePlanner.weightEconomy'))}</option>
      <option value="FIRST">${Util.esc(t('routePlanner.weightFirst'))}</option>
      <option value="TIME">${Util.esc(t('routePlanner.weightTime'))}</option>`;

    root.innerHTML = `
      <h1 class="view-title">${Util.esc(t('routePlanner.title'))}</h1>
      <p class="view-subtitle">${Util.esc(t('routePlanner.subtitle'))}</p>

      <div style="display:flex;gap:8px;margin-bottom:18px">
        <button class="btn btn-primary" id="mode-short">${Util.esc(t('routePlanner.modeShortest'))}</button>
        <button class="btn btn-ghost" id="mode-tsp">${Util.esc(t('routePlanner.modeTsp'))}</button>
      </div>

      <div style="display:grid;grid-template-columns:minmax(280px,380px) minmax(0,1fr);gap:24px;align-items:start">
        <div class="panel" id="planner-form"></div>
        <div>
          <div class="route-map" style="padding:0;margin-bottom:16px"><div id="planner-map"></div></div>
          <div id="planner-result"></div>
        </div>
      </div>`;

    const form = root.querySelector('#planner-form');
    const result = root.querySelector('#planner-result');
    const mapEl = root.querySelector('#planner-map');
    const drawMap = (routes) => RouteMap.render(mapEl, { routes, airports, showAll: true, caption: 'planner' });
    drawMap([]);

    const fmtWeight = (w, weight) => (weight === 'TIME' ? `${w} h` : Util.money(w));

    const showLegsTable = (legs, weight) => `
      <table class="data-table"><thead><tr><th>#</th><th>${Util.esc(t('routePlanner.from'))}</th><th>${Util.esc(t('routePlanner.to'))}</th><th style="text-align:right">${weight === 'TIME' ? 'h' : 'USD'}</th></tr></thead><tbody>
      ${legs.map((l, i) => `<tr><td class="mono">${i + 1}</td><td>${Util.esc(Util.airportLabel(l.from))}</td><td>${Util.esc(Util.airportLabel(l.to))}</td><td class="mono" style="text-align:right">${fmtWeight(l.weight, weight)}</td></tr>`).join('')}
      </tbody></table>`;

    // ---------- Dijkstra ----------
    const shortestMode = () => {
      root.querySelector('#mode-short').className = 'btn btn-primary';
      root.querySelector('#mode-tsp').className = 'btn btn-ghost';
      form.innerHTML = `
        <div class="field"><label>${Util.esc(t('routePlanner.from'))}</label><select id="p-from">${airportOpts}</select></div>
        <div class="field"><label>${Util.esc(t('routePlanner.to'))}</label><select id="p-to">${airportOpts}</select></div>
        <div class="field"><label>${Util.esc(t('routePlanner.weight'))}</label><select id="p-weight">${weightOpts}</select></div>
        <button class="btn btn-accent" id="p-go">${Util.esc(t('routePlanner.calculate'))}</button>`;
      form.querySelector('#p-to').value = 'SAO';
      form.querySelector('#p-from').value = 'LAX';
      result.innerHTML = '';
      drawMap([]);
      form.querySelector('#p-go').onclick = async () => {
        const from = form.querySelector('#p-from').value, to = form.querySelector('#p-to').value, weight = form.querySelector('#p-weight').value;
        if (from === to) return;
        try {
          const r = await ApiClient.get('/api/route/shortest', { from, to, weight });
          drawMap(r.legs.map((l) => ({ from: l.from, to: l.to })));
          const stops = r.path.slice(1, -1);
          result.innerHTML = `
            <div class="panel">
              <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
                <div class="mono" style="font-size:18px;font-weight:700">${r.path.join(' → ')}</div>
                <div><span style="font-size:12px;color:var(--slate-500)">${Util.esc(t(weight === 'TIME' ? 'routePlanner.totalTime' : 'routePlanner.totalCost'))}</span>
                  <span class="mono" style="font-size:22px;font-weight:700;color:#b3760a;margin-left:8px">${fmtWeight(r.total, weight)}</span></div>
              </div>
              ${stops.length ? `<p style="font-size:13px;color:var(--slate-500)">${Util.esc(t('routePlanner.viaStops'))}: ${stops.map((s) => Util.esc(Util.airportLabel(s))).join(', ')}</p>` : ''}
              ${showLegsTable(r.legs, weight)}
            </div>`;
        } catch (err) {
          drawMap([]);
          result.innerHTML = `<div class="banner banner-warn">${Util.esc(err.status === 404 ? t('routePlanner.noRoute') : err.message)}</div>`;
        }
      };
    };

    // ---------- TSP ----------
    const tspMode = () => {
      root.querySelector('#mode-short').className = 'btn btn-ghost';
      root.querySelector('#mode-tsp').className = 'btn btn-primary';
      let picked = ['ATL', 'LON', 'PAR', 'FRA'];
      const drawForm = () => {
        form.innerHTML = `
          <label>${Util.esc(t('routePlanner.airportsLabel'))}</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
            ${picked.map((c, i) => `<span class="tag" style="background:${i === 0 ? 'var(--amber-500)' : 'var(--cloud-100)'};color:var(--navy-950);padding:5px 10px;font-size:12.5px">
              <span class="mono">${c}</span> <a href="#" data-rm="${c}" style="text-decoration:none;margin-left:4px;opacity:.6">✕</a></span>`).join('')}
          </div>
          <div class="field" style="display:flex;gap:8px"><select id="t-add" style="flex:1">${airportOpts}</select><button class="btn btn-ghost btn-sm" id="t-add-btn">+ ${Util.esc(t('routePlanner.addAirport'))}</button></div>
          <div class="field"><label>${Util.esc(t('routePlanner.weight'))}</label><select id="t-weight">${weightOpts}</select></div>
          <div class="field"><label>&nbsp;</label><select id="t-mode"><option value="PATH">${Util.esc(t('routePlanner.tspModePath'))}</option><option value="CYCLE">${Util.esc(t('routePlanner.tspModeCycle'))}</option></select></div>
          <button class="btn btn-accent" id="t-go">${Util.esc(t('routePlanner.calculate'))}</button>`;
        form.querySelectorAll('[data-rm]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); picked = picked.filter((c) => c !== a.dataset.rm); drawForm(); }; });
        form.querySelector('#t-add-btn').onclick = () => {
          const c = form.querySelector('#t-add').value;
          if (!picked.includes(c) && picked.length < 15) { picked.push(c); drawForm(); }
        };
        form.querySelector('#t-go').onclick = async () => {
          const weight = form.querySelector('#t-weight').value, mode = form.querySelector('#t-mode').value;
          if (picked.length < 2) return;
          try {
            const r = await ApiClient.post('/api/route/tsp', { airports: picked, weight, mode });
            const flat = [];
            r.legs.forEach((leg) => { if (leg.detail) leg.detail.legs.forEach((l) => flat.push({ from: l.from, to: l.to })); });
            drawMap(flat);
            const detailed = r.legs.map((leg) => ({ from: leg.from, to: leg.to, weight: leg.cost }));
            result.innerHTML = `
              <div class="panel">
                <div style="font-size:12px;color:var(--slate-500)">${Util.esc(t('routePlanner.tspOrder'))}</div>
                <div class="mono" style="font-size:18px;font-weight:700;margin:4px 0 10px">${r.order.join(' → ')}</div>
                <div style="margin-bottom:12px"><span style="font-size:12px;color:var(--slate-500)">${Util.esc(t(weight === 'TIME' ? 'routePlanner.totalTime' : 'routePlanner.totalCost'))}</span>
                  <span class="mono" style="font-size:22px;font-weight:700;color:#b3760a;margin-left:8px">${fmtWeight(r.total, weight)}</span></div>
                ${showLegsTable(detailed, weight)}
                ${r.legs.filter((l) => l.detail && l.detail.path.length > 2).map((l) => `<p style="font-size:12.5px;color:var(--slate-500);margin:8px 0 0">${l.from} → ${l.to}: ${Util.esc(t('routePlanner.viaStops'))} <span class="mono">${l.detail.path.slice(1, -1).join(', ')}</span></p>`).join('')}
              </div>`;
          } catch (err) {
            drawMap([]);
            result.innerHTML = `<div class="banner banner-warn">${Util.esc(err.status === 404 ? t('routePlanner.noRoute') : err.message)}</div>`;
          }
        };
      };
      drawForm();
      result.innerHTML = '';
      drawMap([]);
    };

    root.querySelector('#mode-short').onclick = shortestMode;
    root.querySelector('#mode-tsp').onclick = tspMode;
    shortestMode();
  },
};
