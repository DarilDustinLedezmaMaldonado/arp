'use strict';

/* global window, ApiClient, Util */

window.Views = window.Views || {};

window.Views.admin = {
  async render(root) {
    const t = window.t;
    try { await ApiClient.get('/api/admin/config'); } catch (err) {
      if (err.status !== 401) throw err;
      root.innerHTML = `<div class="panel"><h1>${Util.esc(t('admin.title'))}</h1>
        <form id="admin-login"><label for="admin-key">${Util.esc(t('admin.accessKey'))}</label>
        <input id="admin-key" type="password" autocomplete="off" required>
        <button class="btn btn-primary" type="submit">${Util.esc(t('common.confirm'))}</button><p id="admin-error" role="alert"></p></form></div>`;
      root.querySelector('#admin-login').onsubmit = async (e) => {
        e.preventDefault();
        ApiClient.adminSecret = root.querySelector('#admin-key').value;
        try { await ApiClient.get('/api/admin/config'); await this.render(root); }
        catch (error) { ApiClient.adminSecret = ''; root.querySelector('#admin-error').textContent = error.message; }
      };
      return;
    }
    await Util.loadAirports();

    root.innerHTML = `
      <h1 class="view-title">${Util.esc(t('admin.title'))}</h1>
      <p class="view-subtitle">${Util.esc(t('admin.subtitle'))}</p>

      <h3 style="font-size:15px;margin:0 0 10px">${Util.esc(t('admin.faultTitle'))}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-bottom:28px" id="ad-nodes"></div>

      <div class="panel" style="margin-bottom:28px" id="ad-tickets"></div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;margin-bottom:28px">
        <div class="panel" id="ad-config"></div>
        <div class="panel" id="ad-clock"></div>
      </div>

      <div class="panel" style="margin-bottom:28px" id="ad-matrix"></div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px">
        <div class="panel"><h4 style="font-size:13px;margin-bottom:8px">${Util.esc(t('admin.outboxTitle'))}</h4><div id="ad-outbox" style="font-size:13px"></div></div>
        <div class="panel"><h4 style="font-size:13px;margin-bottom:8px">${Util.esc(t('admin.eventsTitle'))}</h4><div class="event-log" id="ad-events"></div></div>
      </div>`;

    // ---------------- Tarjetas de nodos con "interruptores de falla" ----------------
    const nodesEl = root.querySelector('#ad-nodes');
    const drawNodes = async () => {
      const probes = await Promise.all(ApiClient.nodes().map(async (n) => {
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 1500);
          const r = await fetch(`${n.url}/health`, { signal: ctl.signal });
          clearTimeout(timer);
          return { n, ok: true, h: await r.json() };
        } catch { return { n, ok: false }; }
      }));
      // No redibujar mientras el usuario esta interactuando con un interruptor
      nodesEl.innerHTML = probes.map(({ n, ok, h }) => `
        <div class="panel" style="${!ok ? 'border-color:var(--rose-600)' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong>${Util.esc(n.flag)} ${Util.esc(n.label)}</strong>
            <span class="node-dot ${!ok || h.faultState.dbDown || h.faultState.networkPartitioned ? 'down' : ''}"></span>
          </div>
          <div class="mono" style="font-size:11.5px;color:var(--slate-500)">${Util.esc(n.url)} · ${ok ? Util.esc(h.dbDriver) : 'offline'}</div>
          ${ok ? `
            <div class="toggle-row"><div><div style="font-size:13.5px;font-weight:600">${Util.esc(t('admin.dbDownLabel'))}</div><div style="font-size:11.5px;color:var(--slate-500);max-width:34ch">${Util.esc(t('admin.dbDownHint'))}</div></div>
              <label class="switch"><input type="checkbox" data-node="${n.id}" data-fault="dbDown" ${h.faultState.dbDown ? 'checked' : ''}><span class="track"></span></label></div>
            <div class="toggle-row" style="border:none"><div><div style="font-size:13.5px;font-weight:600">${Util.esc(t('admin.partitionLabel'))}</div><div style="font-size:11.5px;color:var(--slate-500);max-width:34ch">${Util.esc(t('admin.partitionHint'))}</div></div>
              <label class="switch"><input type="checkbox" data-node="${n.id}" data-fault="networkPartitioned" ${h.faultState.networkPartitioned ? 'checked' : ''}><span class="track"></span></label></div>`
          : `<p style="color:var(--rose-600);font-size:13px">${Util.esc(t('dashboardGlobal.unreachable'))}</p>`}
        </div>`).join('');
      nodesEl.querySelectorAll('input[data-fault]').forEach((cb) => {
        cb.onchange = async () => {
          const node = ApiClient.nodeById(cb.dataset.node);
          try {
            await ApiClient.post('/api/admin/fault', { [cb.dataset.fault]: cb.checked }, node.url);
            Util.toast(`${node.label}: ${cb.dataset.fault} = ${cb.checked}`, cb.checked ? 'warn' : 'ok');
          } catch (err) { Util.toast(err.message, 'error'); }
          drawNodes();
        };
      });
    };

    // ---------------- Pasajes recientes (de los 3 nodos) y en que nodos ya estan replicados ----------------
    const tk = root.querySelector('#ad-tickets');
    tk.innerHTML = `
      <div class="tickets-head">
        <div><h4 style="font-size:14px;margin:0">${Util.esc(t('admin.tickets.title'))}</h4>
          <p style="font-size:12.5px;color:var(--slate-500);margin:4px 0 0;max-width:70ch">${Util.esc(t('admin.tickets.hint'))}</p></div>
        <div class="tickets-controls">
          <select id="tk-type" style="width:auto">
            <option value="PURCHASE">${Util.esc(t('admin.tickets.typePurchase'))}</option>
            <option value="RESERVE">${Util.esc(t('admin.tickets.typeReserve'))}</option>
            <option value="ALL">${Util.esc(t('admin.tickets.typeAll'))}</option>
          </select>
          <input id="tk-q" type="search" placeholder="${Util.esc(t('admin.tickets.search'))}" style="width:220px">
          <button class="btn btn-ghost btn-sm" id="tk-refresh">↻</button>
        </div>
      </div>
      <div style="overflow-x:auto"><table class="data-table tickets-table">
        <thead><tr>
          <th>${Util.esc(t('admin.tickets.when'))}</th><th>PNR</th><th>${Util.esc(t('receipt.passenger'))}</th><th>${Util.esc(t('search.colFlight'))}</th>
          <th>${Util.esc(t('receipt.seat'))}</th><th>${Util.esc(t('receipt.statusLabel'))}</th>
          <th title="${Util.esc(t('admin.tickets.boughtAt'))} → ${Util.esc(t('admin.tickets.owner'))}">${Util.esc(t('admin.tickets.nodes'))}</th>
          <th>${Util.esc(t('admin.tickets.replicas'))}</th><th></th>
        </tr></thead>
        <tbody id="tk-body"></tbody>
      </table></div>
      <div id="tk-foot" style="font-size:12px;color:var(--slate-400);margin-top:8px"></div>`;

    const statusText = (s) => {
      const key = { SOLD: 'seatLegend.sold', RESERVED: 'seatLegend.reserved', CHECKED_IN: 'seatLegend.checkedIn', REFUNDED: 'receipt.statusRefunded',
        AVAILABLE: 'receipt.statusReleased', PENDING: 'receipt.pendingConfirmation', REJECTED: 'receipt.rejected', CONFLICT_LOST: 'admin.tickets.conflictLost' }[s];
      return key ? t(key) : s;
    };
    const statusTone = (s) => ({ SOLD: 'tag-synced', CHECKED_IN: 'tag-synced', RESERVED: 'tag-pending', PENDING: 'tag-pending' }[s] || 'tag-conflict');
    const shortNode = (id) => { const n = ApiClient.nodeById(id); return n ? `${n.flag} ${id.replace(/^NODE_/, '')}` : id; };

    const drawTickets = async () => {
      const params = { type: tk.querySelector('#tk-type').value, q: tk.querySelector('#tk-q').value.trim() || undefined, limit: 30 };
      const nodes = ApiClient.nodes();
      const lists = await Promise.allSettled(nodes.map((n) => ApiClient.get('/api/admin/tickets', params, n.url)));
      // Union de lo que conoce cada nodo; ante duplicados gana la version confirmada por el dueno.
      const byId = new Map();
      lists.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        for (const tx of r.value.tickets) {
          const prev = byId.get(tx.id);
          if (!prev || (prev.syncStatus !== 'SYNCED' && tx.syncStatus === 'SYNCED') || (prev.lamportTs || 0) < (tx.lamportTs || 0)) byId.set(tx.id, tx);
        }
      });
      const rows = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
      const ids = rows.map((r) => r.id);
      const presence = await Promise.all(nodes.map((n, i) => (lists[i].status === 'fulfilled' && ids.length
        ? ApiClient.get('/api/admin/tickets/presence', { ids: ids.join(',') }, n.url).then((p) => p.presence).catch(() => null)
        : Promise.resolve(lists[i].status === 'fulfilled' ? {} : null))));

      const replicaChips = (tx) => nodes.map((n, i) => {
        const p = presence[i];
        const code = n.id.replace(/^NODE_/, '');
        if (!p) return `<span class="rep-chip off" title="${Util.esc(n.label)}: offline">${code} ✗</span>`;
        const seen = p[tx.id];
        const ok = seen && seen.syncStatus === 'SYNCED' && seen.status !== 'PENDING';
        return `<span class="rep-chip ${ok ? 'ok' : 'wait'}" title="${Util.esc(n.label)}: ${Util.esc(seen ? seen.status : t('admin.tickets.notYet'))}">${code} ${ok ? '✓' : '⏳'}</span>`;
      }).join('');

      tk.querySelector('#tk-body').innerHTML = rows.length ? rows.map((tx) => {
        const f = tx.flight || {};
        const shown = tx.currentStatus && tx.currentStatus !== tx.status ? tx.currentStatus : tx.status;
        return `<tr>
          <td class="mono" style="white-space:nowrap">${new Date(tx.createdAt).toLocaleTimeString(window.I18n.lang)}
            <div style="font-size:11px;color:var(--slate-500)">${new Date(tx.createdAt).toLocaleDateString(window.I18n.lang, { day: '2-digit', month: 'short' })} · L${tx.lamportTs}</div></td>
          <td class="mono">${Util.esc(tx.pnr || '—')}</td>
          <td>${Util.esc(tx.passengerName || '—')}</td>
          <td style="white-space:nowrap"><span class="mono">${Util.flightNumber(tx.flightId)}</span> ${Util.esc(f.origin || '')}→${Util.esc(f.destination || '')}
            <div style="font-size:11.5px;color:var(--slate-500)">${Util.esc(f.date || '')} ${Util.esc(f.time || '')}</div></td>
          <td class="mono">${Util.esc(tx.seatNumber)}</td>
          <td><span class="tag ${statusTone(shown)}">${Util.esc(statusText(shown))}</span></td>
          <td style="white-space:nowrap" title="${Util.esc(t('admin.tickets.boughtAt'))} → ${Util.esc(t('admin.tickets.owner'))}">${Util.esc(shortNode(tx.originNode))} → ${Util.esc(shortNode(tx.ownerNode))}</td>
          <td style="white-space:nowrap">${replicaChips(tx)}</td>
          <td><a class="btn btn-ghost btn-sm" style="text-decoration:none" href="#/receipt/${encodeURIComponent(tx.id)}">${Util.esc(t('admin.tickets.open'))}</a></td>
        </tr>`;
      }).join('') : `<tr><td colspan="9" style="text-align:center;color:var(--slate-500);padding:22px">${Util.esc(t('admin.tickets.empty'))}</td></tr>`;
      const reachable = lists.filter((r) => r.status === 'fulfilled').length;
      tk.querySelector('#tk-foot').textContent = t('admin.tickets.footer', { count: rows.length, reachable, total: nodes.length, time: new Date().toLocaleTimeString(window.I18n.lang) });
    };

    let searchTimer = null;
    tk.querySelector('#tk-type').onchange = () => drawTickets();
    tk.querySelector('#tk-q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(drawTickets, 300); };
    tk.querySelector('#tk-refresh').onclick = () => drawTickets();

    // ---------------- Parametros ----------------
    const cfgEl = root.querySelector('#ad-config');
    const drawConfig = async () => {
      const c = await ApiClient.get('/api/admin/config');
      cfgEl.innerHTML = `
        <h4 style="font-size:14px;margin-bottom:12px">${Util.esc(t('admin.configTitle'))}</h4>
        <div class="field-row">
          <div class="field"><label>${Util.esc(t('admin.soldPct'))}</label><input id="cfg-sold" type="number" min="0" max="100" step="1" value="${Math.round(c.soldPct * 100)}"></div>
          <div class="field"><label>${Util.esc(t('admin.reservedPct'))}</label><input id="cfg-res" type="number" min="0" max="100" step="1" value="${Math.round(c.reservedPct * 100)}"></div>
          <div class="field"><label>${Util.esc(t('admin.refundDelay'))}</label><input id="cfg-delay" type="number" min="1" step="1" value="${c.refundDelaySeconds}"></div>
        </div>
        <button class="btn btn-primary" id="cfg-save">${Util.esc(t('admin.applyConfig'))}</button>`;
      cfgEl.querySelector('#cfg-save').onclick = async () => {
        try {
          const sold = Number(cfgEl.querySelector('#cfg-sold').value) / 100;
          const res = Number(cfgEl.querySelector('#cfg-res').value) / 100;
          if (sold + res > 1) { Util.toast('% vendidos + % reservados > 100', 'error'); return; }
          await ApiClient.post('/api/admin/config', { key: 'soldPct', value: sold });
          await ApiClient.post('/api/admin/config', { key: 'reservedPct', value: res });
          await ApiClient.post('/api/admin/config', { key: 'refundDelaySeconds', value: Number(cfgEl.querySelector('#cfg-delay').value) });
          Util.toast('OK');
        } catch (err) { Util.toast(err.message, 'error'); }
      };
    };

    // ---------------- Reloj / outbox / eventos (nodo seleccionado) ----------------
    const drawLive = async () => {
      const [status, outbox, events] = await Promise.all([
        ApiClient.get('/api/admin/status'), ApiClient.get('/api/admin/outbox'), ApiClient.get('/api/admin/events', { limit: 40 }),
      ]);
      root.querySelector('#ad-clock').innerHTML = `
        <h4 style="font-size:14px;margin-bottom:10px">${Util.esc(t('admin.clockTitle'))} — ${Util.esc(status.nodeId)}</h4>
        <div style="display:flex;gap:26px;flex-wrap:wrap">
          <div><div style="font-size:11.5px;color:var(--slate-500)">${Util.esc(t('admin.lamport'))}</div><div class="mono" style="font-size:28px;font-weight:700">${status.clocks.lamportTs}</div></div>
          <div><div style="font-size:11.5px;color:var(--slate-500)">${Util.esc(t('admin.vector'))}</div>
            <div class="mono" style="font-size:18px;font-weight:700;margin-top:6px">[ NA:${status.clocks.vectorClock.NODE_NA} · EA:${status.clocks.vectorClock.NODE_EA} · SA:${status.clocks.vectorClock.NODE_SA} ]</div></div>
        </div>
        <div style="margin-top:12px;font-size:12.5px;color:var(--slate-500)">${Util.esc(status.label)} · <span class="mono">${Util.esc(status.dbDriver)}</span> · ${Util.number(status.flightsLoaded)} vuelos</div>`;
      root.querySelector('#ad-outbox').innerHTML = outbox.length === 0 ? '<span style="color:var(--green-600)">✓ 0</span>' :
        outbox.map((o) => `<div style="padding:7px 0;border-bottom:1px solid var(--cloud-100)"><span class="tag tag-pending">→ ${Util.esc(o.target_node)}</span> <span class="mono" style="font-size:11.5px">${Util.esc(o.event_type)}</span> <span style="color:var(--slate-400);font-size:11.5px">×${o.attempts}</span></div>`).join('');
      root.querySelector('#ad-events').innerHTML = events.map((e) => `<div class="event-row"><span class="lamport">L${e.lamport_ts}</span><div style="flex:1"><span class="evt-type">${Util.esc(e.event_type)}</span> ${Util.esc(e.summary)}</div></div>`).join('');
    };

    // ---------------- Editor de matrices tipo Excel ----------------
    const mx = root.querySelector('#ad-matrix');
    let kind = 'economy';
    let order = [];

    const drawMatrix = async () => {
      const raw = await ApiClient.get(`/api/admin/matrix/${kind}`);
      order = raw.order;
      const rowsHtml = order.map((rc, i) => `<tr><th class="mx-h">${rc}</th>${order.map((cc, j) => {
        const v = raw.matrix[i][j];
        if (i === j) return '<td class="mx-diag"><input value="0" disabled></td>';
        return `<td class="${v === null ? 'mx-empty' : ''}"><input data-r="${i}" data-c="${j}" value="${v === null ? '' : v}" inputmode="numeric"></td>`;
      }).join('')}</tr>`).join('');

      mx.innerHTML = `
        <style>
          #ad-matrix table.mx { border-collapse:collapse; font-family:var(--font-mono); font-size:11.5px; }
          #ad-matrix .mx th { background:var(--navy-950); color:#fff; padding:4px 6px; font-weight:600; position:sticky; top:0; }
          #ad-matrix .mx th.mx-h { position:sticky; left:0; text-align:left; }
          #ad-matrix .mx td { border:1px solid var(--cloud-200); padding:0; }
          #ad-matrix .mx td input { width:56px; border:none; border-radius:0; padding:5px 4px; text-align:right; font-family:inherit; font-size:inherit; background:transparent; }
          #ad-matrix .mx td.mx-empty { background:#f7d6d6; }
          #ad-matrix .mx td.mx-diag { background:#bfe5d0; }
          #ad-matrix .mx td input:focus { outline:2px solid var(--blue-500); outline-offset:-2px; background:#fff; }
        </style>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px">
          <h4 style="font-size:14px">${Util.esc(t('admin.matrixTitle'))}</h4>
          <select id="mx-kind" style="width:auto">
            <option value="economy" ${kind === 'economy' ? 'selected' : ''}>${Util.esc(t('admin.matrixEconomy'))}</option>
            <option value="first" ${kind === 'first' ? 'selected' : ''}>${Util.esc(t('admin.matrixFirst'))}</option>
            <option value="time" ${kind === 'time' ? 'selected' : ''}>${Util.esc(t('admin.matrixTime'))}</option>
          </select>
        </div>
        <p style="font-size:12.5px;color:var(--slate-500);margin:0 0 10px">${Util.esc(t('admin.pasteHint'))}</p>
        <div style="overflow:auto;max-height:520px;border:1px solid var(--cloud-200);border-radius:6px">
          <table class="mx" id="mx-table"><thead><tr><th></th>${order.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-primary" id="mx-save">${Util.esc(t('admin.saveMatrix'))}</button>
          <button class="btn btn-ghost" id="mx-copy">${Util.esc(t('admin.exportTsv'))}</button>
          <button class="btn btn-ghost" id="mx-reprice">${Util.esc(t('admin.repriceButton'))}</button>
        </div>
        <p style="font-size:12px;color:var(--slate-400);margin:8px 0 0">${Util.esc(t('admin.repriceHint'))}</p>`;

      const table = mx.querySelector('#mx-table');
      const inputs = () => [...table.querySelectorAll('input[data-r]')];
      const cell = (r, c) => table.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
      const refreshTint = (inp) => { inp.parentElement.className = inp.value.trim() === '' ? 'mx-empty' : ''; };
      inputs().forEach((inp) => inp.addEventListener('input', () => refreshTint(inp)));

      // Pegar desde Excel: acepta 15x15 o 16x16 (con encabezados) desde la celda activa
      table.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!/[\t\n]/.test(text)) return; // pegado de una sola celda: comportamiento normal
        e.preventDefault();
        let grid = text.replace(/\r/g, '').split('\n').filter((l) => l.length).map((l) => l.split('\t'));
        const hasHeader = grid[0] && grid[0].slice(1).some((c) => /^[A-Z]{3}\b/.test((c || '').trim()));
        let startR = 0, startC = 0;
        if (hasHeader) { grid = grid.slice(1).map((r) => r.slice(1)); } else {
          const f = document.activeElement;
          if (f && f.dataset && f.dataset.r !== undefined) { startR = Number(f.dataset.r); startC = Number(f.dataset.c); }
        }
        grid.forEach((row, ri) => row.forEach((val, ci) => {
          const inp = cell(startR + ri, startC + ci);
          if (!inp) return;
          const clean = val.trim().replace(/,/g, '');
          inp.value = clean === '0' ? '' : clean;
          refreshTint(inp);
        }));
        Util.toast(`${grid.length}×${grid[0] ? grid[0].length : 0} ✓`);
      });

      mx.querySelector('#mx-kind').onchange = (e) => { kind = e.target.value; drawMatrix(); };

      mx.querySelector('#mx-save').onclick = async () => {
        const lines = ['\t' + order.join('\t')];
        for (let i = 0; i < order.length; i++) {
          const cells = order.map((_, j) => (i === j ? '0' : (cell(i, j).value.trim())));
          lines.push(order[i] + '\t' + cells.join('\t'));
        }
        if (kind === 'time' && lines.slice(1).some((l, i) => l.split('\t').slice(1).some((v, j) => i !== j && v === ''))) {
          Util.toast('La matriz de tiempos no puede tener celdas vacías.', 'error'); return;
        }
        try {
          await ApiClient.post(`/api/admin/matrix/${kind}`, { tsv: lines.join('\n') });
          Util.toast('Matriz guardada y enviada a los otros nodos ✓');
        } catch (err) { Util.toast(err.message, 'error'); }
      };

      mx.querySelector('#mx-copy').onclick = async () => {
        const matrixPath = `/api/admin/matrix/${kind}/tsv`;
        const res = await fetch(ApiClient.absolute(matrixPath), { headers: ApiClient.adminHeaders(matrixPath) });
        if (!res.ok) throw new Error(`Error HTTP ${res.status}`);
        const text = await res.text();
        try { await navigator.clipboard.writeText(text); Util.toast('Copiado: pégalo en Excel ✓'); } catch { window.prompt('Copia (Ctrl+C):', text); }
      };

      mx.querySelector('#mx-reprice').onclick = async () => {
        Util.toast('Recalculando 60,000 vuelos en los 3 nodos…', 'warn');
        const results = await Promise.allSettled(ApiClient.nodes().map((n) => ApiClient.post('/api/admin/reprice', {}, n.url)));
        const ok = results.filter((r) => r.status === 'fulfilled').length;
        Util.toast(`Precios recalculados en ${ok}/${results.length} nodos`, ok === results.length ? 'ok' : 'warn');
      };
    };

    await Promise.all([drawNodes(), drawTickets(), drawConfig(), drawLive(), drawMatrix()]);
    Util.poll(drawNodes, 3500);
    Util.poll(drawTickets, 4000);
    Util.poll(drawLive, 3500);
  },
};
