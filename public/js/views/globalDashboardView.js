'use strict';

/* global window, ApiClient, Util, RouteMap, Charts */

window.Views = window.Views || {};

async function probeNode(node) {
  const started = performance.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`${node.url}/health`, { signal: ctl.signal });
    clearTimeout(timer);
    const body = await res.json();
    return { node, ok: true, latency: Math.round(performance.now() - started), health: body };
  } catch {
    return { node, ok: false };
  }
}

window.Views.globalDashboard = {
  async render(root) {
    const t = window.t;
    await Util.loadAirports();

    root.innerHTML = `
      <h1 class="view-title">${Util.esc(t('dashboardGlobal.title'))}</h1>
      <p class="view-subtitle">${Util.esc(t('dashboardGlobal.subtitle'))}</p>

      <h3 style="font-size:15px;margin:0 0 10px">${Util.esc(t('dashboardGlobal.nodesTitle'))}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:24px" id="gd-nodes"></div>

      <div class="route-map" style="padding:0;margin-bottom:22px"><div id="gd-map"></div></div>

      <h3 style="font-size:15px;margin:0 0 4px">${Util.esc(t('dashboardGlobal.baselineTitle'))}</h3>
      <p style="font-size:12.5px;color:var(--slate-500);margin:0 0 12px;max-width:80ch">${Util.esc(t('dashboardGlobal.baselineNote'))}</p>
      <div class="stat-strip" id="gd-base-stats"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-bottom:26px">
        <div class="panel"><div style="max-width:250px;margin:0 auto"><canvas id="gd-donut"></canvas></div></div>
        <div class="panel"><h4 style="font-size:13px;margin-bottom:8px">${Util.esc(t('dashboardFlight.revenue'))} (USD)</h4><canvas id="gd-rev"></canvas></div>
        <div class="panel"><h4 style="font-size:13px;margin-bottom:8px">${Util.esc(t('dashboardGlobal.byRegion'))}</h4><canvas id="gd-owner"></canvas></div>
      </div>

      <h3 style="font-size:15px;margin:0 0 10px">${Util.esc(t('dashboardGlobal.liveTitle'))}</h3>
      <div class="stat-strip" id="gd-live-stats"></div>
      <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:18px" id="gd-lower">
        <div class="panel"><h4 style="font-size:13px;margin-bottom:8px">${Util.esc(t('dashboardGlobal.eventLogTitle'))}</h4><div class="event-log" id="gd-events"></div></div>
        <div class="panel"><h4 style="font-size:13px;margin-bottom:8px">${Util.esc(t('dashboardGlobal.pendingOutbox'))}</h4><div id="gd-outbox" style="font-size:13px"></div></div>
      </div>`;

    // mapa de red con TODAS las rutas directas que tienen vuelos (endpoint publico: no pide clave de administracion)
    try {
      const { routes: pairs } = await ApiClient.get('/api/routes');
      const routes = pairs.map((r) => ({ from: r.from, to: r.to, highlight: false }));
      RouteMap.render(root.querySelector('#gd-map'), { routes, airports: Util.airportData.airports, showAll: true, animate: false, caption: 'network' });
    } catch { /* el mapa es decorativo */ }

    const drawNodes = async () => {
      const probes = await Promise.all(ApiClient.nodes().map(probeNode));
      root.querySelector('#gd-nodes').innerHTML = probes.map((p) => {
        const f = p.ok ? p.health.faultState : null;
        const bad = !p.ok || f.dbDown || f.networkPartitioned;
        return `<div class="node-card ${!p.ok ? 'down' : ''}">
          <div>
            <div style="font-weight:600">${Util.esc(p.node.flag)} ${Util.esc(p.node.label)}</div>
            <div style="font-size:12px;color:var(--slate-500);margin-top:2px" class="mono">${Util.esc(p.node.url)}</div>
            <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
              ${p.ok ? `<span class="tag tag-synced">${Util.esc(t('dashboardGlobal.reachable'))} · ${p.latency}ms</span>` : `<span class="tag tag-conflict">${Util.esc(t('dashboardGlobal.unreachable'))}</span>`}
              ${p.ok ? `<span class="tag" style="background:var(--cloud-100);color:var(--slate-500)">${Util.esc(p.health.dbDriver)}</span>` : ''}
              ${f && f.dbDown ? '<span class="tag tag-conflict">DB DOWN</span>' : ''}
              ${f && f.networkPartitioned ? '<span class="tag tag-pending">PARTITIONED</span>' : ''}
            </div>
          </div>
          <span class="node-dot ${bad ? 'down' : ''}"></span>
        </div>`;
      }).join('');
    };

    const drawData = async () => {
      const data = await ApiClient.get('/api/admin/dashboard/global');
      const b = data.baseline, l = data.live;
      const sold = b.byClass.FIRST.sold + b.byClass.ECONOMY.sold;
      const res = b.byClass.FIRST.reserved + b.byClass.ECONOMY.reserved;
      const avail = b.byClass.FIRST.available + b.byClass.ECONOMY.available;
      const rev = b.byClass.FIRST.revenue + b.byClass.ECONOMY.revenue;

      root.querySelector('#gd-base-stats').innerHTML = `
        <div class="stat-box"><div class="stat-box__label">Vuelos</div><div class="stat-box__value">${Util.number(b.totalFlights)}</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.sold'))}</div><div class="stat-box__value">${Util.number(sold)}</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.reserved'))}</div><div class="stat-box__value">${Util.number(res)}</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.revenue'))}</div><div class="stat-box__value amber">${Util.money(rev)}</div>
          <div class="stat-box__sub">${Util.money(b.byClass.FIRST.revenue)} 1ª · ${Util.money(b.byClass.ECONOMY.revenue)} T</div></div>`;

      Charts.doughnut('gd-donut', root.querySelector('#gd-donut'),
        [t('dashboardFlight.sold'), t('dashboardFlight.reserved'), t('dashboardFlight.available')], [sold, res, avail], ['#c23f4a', '#f2a104', '#2f9e74']);
      Charts.bar('gd-rev', root.querySelector('#gd-rev'),
        [t('dashboardFlight.firstClass'), t('dashboardFlight.economyClass')],
        [{ label: 'USD', data: [b.byClass.FIRST.revenue, b.byClass.ECONOMY.revenue], backgroundColor: ['#f2a104', '#0b3d91'] }]);
      const owners = Object.keys(b.byOwnerNode);
      Charts.bar('gd-owner', root.querySelector('#gd-owner'),
        owners.map((o) => { const n = ApiClient.nodeById(o); return n ? n.flag + ' ' + o.replace('NODE_', '') : o; }),
        [{ label: 'Vuelos', data: owners.map((o) => b.byOwnerNode[o]), backgroundColor: ['#0b3d91', '#2563c9', '#f2a104'] }]);

      const ls = l.byClass;
      root.querySelector('#gd-live-stats').innerHTML = `
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.sold'))}</div><div class="stat-box__value">${ls.FIRST.sold + ls.ECONOMY.sold}</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.reserved'))}</div><div class="stat-box__value">${ls.FIRST.reserved + ls.ECONOMY.reserved}</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardFlight.revenue'))}</div><div class="stat-box__value amber">${Util.money(ls.FIRST.revenue + ls.ECONOMY.revenue)}</div>
          <div class="stat-box__sub">${Util.money(ls.FIRST.revenue)} 1ª · ${Util.money(ls.ECONOMY.revenue)} T</div></div>
        <div class="stat-box"><div class="stat-box__label">${Util.esc(t('dashboardGlobal.pendingOutbox'))}</div><div class="stat-box__value" style="color:${l.pendingOutboxCount ? 'var(--rose-600)' : 'var(--green-600)'}">${l.pendingOutboxCount}</div></div>`;

      root.querySelector('#gd-events').innerHTML = l.recentEvents.length === 0 ? '<span style="color:var(--slate-400)">—</span>' :
        l.recentEvents.map((e) => `<div class="event-row"><span class="lamport">L${e.lamport_ts}</span>
          <div style="flex:1"><span class="evt-type">${Util.esc(e.event_type)}</span> <span>${Util.esc(e.summary)}</span>
          <div class="mono" style="font-size:10.5px;color:var(--slate-400)">NA:${e.vectorClock.NODE_NA} EA:${e.vectorClock.NODE_EA} SA:${e.vectorClock.NODE_SA} · ${Util.esc(e.origin_node)}</div></div></div>`).join('');

      root.querySelector('#gd-outbox').innerHTML = l.pendingOutbox.length === 0 ? '<span style="color:var(--green-600)">✓ 0</span>' :
        l.pendingOutbox.map((o) => `<div style="padding:7px 0;border-bottom:1px solid var(--cloud-100)"><span class="tag tag-pending">→ ${Util.esc(o.target_node)}</span>
          <span class="mono" style="font-size:11.5px">${Util.esc(o.event_type)}</span> <span style="color:var(--slate-400);font-size:11.5px">×${o.attempts}</span></div>`).join('');
    };

    await Promise.all([drawNodes(), drawData()]);
    Util.poll(drawNodes, 3000);
    Util.poll(drawData, 4000);
  },
};
