'use strict';

/* global window, ApiClient, Util */

window.Views = window.Views || {};

const STATUS_ORDER = ['SCHEDULED', 'DELAYED', 'BOARDING', 'DEPARTED', 'IN_FLIGHT', 'LANDED', 'ARRIVED', 'CANCELLED', 'UNKNOWN'];
const SELLABLE = ['SCHEDULED', 'DELAYED'];

/** Todos los vuelos del dataset con su estado real (a la venta o no). */
window.Views.flightStatus = {
  async render(root) {
    const t = window.t;
    const { order, airports } = await Util.loadAirports();
    const opts = (anyKey) => `<option value="">${Util.esc(t(anyKey))}</option>` +
      order.map((c) => `<option value="${c}">${Util.esc(c + ' · ' + airports[c].city)}</option>`).join('');
    const dayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString(window.I18n.lang, { weekday: 'short', day: 'numeric', month: 'short' });

    root.innerHTML = `
      <h1 class="view-title" style="margin-bottom:4px">${Util.esc(t('statusBoard.title'))}</h1>
      <p class="itin-sub" style="margin:0 0 18px">${Util.esc(t('statusBoard.subtitle'))}</p>
      <div class="panel status-filters">
        <div class="field-row">
          <div class="field"><label>${Util.esc(t('statusBoard.date'))}</label><select id="sb-date"></select></div>
          <div class="field"><label>${Util.esc(t('search.origin'))}</label><select id="sb-origin">${opts('search.anyOrigin')}</select></div>
          <div class="field"><label>${Util.esc(t('search.destination'))}</label><select id="sb-destination">${opts('search.anyDestination')}</select></div>
        </div>
        <div class="status-chips" id="sb-chips" role="radiogroup"></div>
        <p class="itin-note" style="margin:10px 0 0">${Util.esc(t('statusBoard.note'))}</p>
      </div>
      <div class="results-toolbar"><h2 style="font-size:18px" id="sb-title"></h2></div>
      <div class="board" id="sb-board"></div>
      <div style="text-align:center;margin-top:16px"><button class="btn btn-ghost" id="sb-more" style="display:none">+</button></div>`;

    const dateSel = root.querySelector('#sb-date');
    const originSel = root.querySelector('#sb-origin');
    const destSel = root.querySelector('#sb-destination');
    const chips = root.querySelector('#sb-chips');
    const board = root.querySelector('#sb-board');
    const title = root.querySelector('#sb-title');
    const moreBtn = root.querySelector('#sb-more');
    const PAGE = 20;
    let status = '';
    let offset = 0;

    const headHtml = `<div class="board__head">
        <span>${Util.esc(t('search.colFlight'))}</span><span>${Util.esc(t('search.colRoute'))}</span><span>${Util.esc(t('search.colDate'))}</span>
        <span>${Util.esc(t('search.colTime'))}</span><span>${Util.esc(t('statusBoard.gate'))}</span><span>${Util.esc(t('search.colStatus'))}</span><span>${Util.esc(t('statusBoard.sale'))}</span></div>`;

    const rowHtml = (f) => {
      const onSale = SELLABLE.includes(f.status);
      return `
      <div class="board__row${onSale ? '' : ' board__row--closed'}" data-id="${f.id}" data-sale="${onSale}" tabindex="0" role="link">
        <span class="flight-code col-1">${Util.flightNumber(f.id)}</span>
        <span class="route col-2">${f.origin} → ${f.destination}<div style="font-size:11.5px;font-weight:400;color:var(--slate-400)">${Util.esc((airports[f.origin] || {}).city)} — ${Util.esc((airports[f.destination] || {}).city)}</div></span>
        <span class="col-3 mono" style="font-size:13px">${f.date.slice(5)}</span>
        <span class="flight-time col-4">${f.time}</span>
        <span class="col-5 mono" style="font-size:12.5px;color:#b8c6e2">${Util.esc(f.gate || '—')}</span>
        <span class="col-6">${Util.statusBadge(f.status)}</span>
        <span class="col-7" style="font-size:12.5px;color:${onSale ? '#58d69b' : 'var(--slate-400)'}">${Util.esc(t(onSale ? 'statusBoard.onSale' : 'statusBoard.closed'))}</span>
      </div>`;
    };

    const filters = () => ({
      origin: originSel.value || undefined,
      destination: destSel.value || undefined,
      dateFrom: dateSel.value || undefined,
      dateTo: dateSel.value || undefined,
    });

    const drawChips = async () => {
      const { counts } = await ApiClient.get('/api/flights/status-counts', filters());
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const present = STATUS_ORDER.filter((s) => counts[s]);
      if (status && !counts[status]) status = '';
      chips.innerHTML = [{ key: '', label: t('statusBoard.all'), n: total }]
        .concat(present.map((s) => ({ key: s, label: t('flightStatus.' + s), n: counts[s] })))
        .map((c) => `<button type="button" role="radio" aria-checked="${c.key === status}" data-status="${c.key}" class="status-chip ${c.key}">
          ${Util.esc(c.label)} <span class="mono">${Util.number(c.n)}</span></button>`).join('');
      chips.querySelectorAll('[data-status]').forEach((b) => {
        b.onclick = () => { status = b.dataset.status; drawChips(); load(true); };
      });
    };

    const load = async (reset) => {
      if (reset) { offset = 0; board.innerHTML = headHtml + `<div class="board-empty">${Util.esc(t('common.loading'))}</div>`; }
      try {
        const data = await ApiClient.get('/api/flights', { ...filters(), status: status || undefined, sort: 'DEPARTURE', limit: PAGE, offset });
        title.textContent = t('statusBoard.count', { count: Util.number(data.total) });
        if (reset) board.innerHTML = headHtml;
        if (!data.total) board.innerHTML = headHtml + `<div class="board-empty">${Util.esc(t('search.noResults'))}</div>`;
        board.insertAdjacentHTML('beforeend', data.rows.map(rowHtml).join(''));
        board.querySelectorAll('.board__row:not([data-bound])').forEach((row) => {
          row.dataset.bound = '1';
          // A la venta -> comprar; cerrado -> panel del vuelo (ocupacion, transacciones).
          const go = () => { window.location.hash = row.dataset.sale === 'true' ? `#/booking/${row.dataset.id}` : `#/dashboard/flight/${row.dataset.id}`; };
          row.onclick = go;
          row.onkeydown = (e) => { if (e.key === 'Enter') go(); };
        });
        offset += data.rows.length;
        moreBtn.style.display = offset < data.total ? 'inline-flex' : 'none';
        moreBtn.textContent = `+ ${Math.min(PAGE, data.total - offset)}`;
      } catch (err) {
        board.innerHTML = headHtml + `<div class="board-empty">${Util.esc(t('common.error'))}: ${Util.esc(err.message)}</div>`;
      }
    };

    const { dates } = await ApiClient.get('/api/flights/dates');
    dateSel.innerHTML = `<option value="">${Util.esc(t('search.anyDate'))}</option>` +
      dates.map((d) => `<option value="${d.date}">${Util.esc(t('search.dateOption', { date: dayLabel(d.date), count: Util.number(d.count) }))}</option>`).join('');

    [dateSel, originSel, destSel].forEach((el) => el.addEventListener('change', async () => { await drawChips(); load(true); }));
    moreBtn.addEventListener('click', () => load(false));

    await drawChips();
    await load(true);
  },
};
