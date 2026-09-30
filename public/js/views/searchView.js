'use strict';

/* global window, document, ApiClient, Util */

window.Views = window.Views || {};

window.Views.search = {
  async render(root) {
    const t = window.t;
    const { order, airports } = await Util.loadAirports();
    const opts = (anyKey) => `<option value="">${Util.esc(t(anyKey))}</option>` +
      order.map((c) => `<option value="${c}">${Util.esc(c + ' · ' + airports[c].city)}</option>`).join('');

    root.innerHTML = `
      <section class="hero">
        <div class="hero__eyebrow">${Util.esc(t('search.eyebrow'))}</div>
        <h1>${Util.esc(t('search.title'))}</h1>
        <p style="color:#cddaf2;margin:-6px 0 20px;max-width:56ch;font-size:14.5px">${Util.esc(t('search.subtitle'))}</p>
        <form class="search-form" id="search-form">
          <div class="trip-toggle" role="radiogroup">
            <button type="button" role="radio" data-trip="oneway" aria-checked="true">${Util.esc(t('search.tripOneWay'))}</button>
            <button type="button" role="radio" data-trip="round" aria-checked="false">${Util.esc(t('search.tripRound'))}</button>
          </div>
          <div class="field-row">
            <div class="field"><label>${Util.esc(t('search.origin'))}</label><select name="origin">${opts('search.anyOrigin')}</select></div>
            <div class="field"><label>${Util.esc(t('search.destination'))}</label><select name="destination">${opts('search.anyDestination')}</select></div>
            <div class="field"><label>${Util.esc(t('search.departDate'))}</label><select name="departDate"></select></div>
            <div class="field" id="return-field" hidden><label>${Util.esc(t('search.returnDate'))}</label><select name="returnDate"></select></div>
          </div>
          <p class="trip-hint" id="trip-hint" hidden>${Util.esc(t('search.roundNeedsRoute'))}</p>
          <button class="btn btn-accent" type="submit">${Util.esc(t('search.submit'))}</button>
        </form>
      </section>

      <div id="tickets-slot"></div>

      <div class="leg-tabs" id="leg-tabs" role="tablist" hidden></div>

      <div class="results-toolbar">
        <h2 style="font-size:18px" id="results-title"></h2>
        <label class="sort-control">${Util.esc(t('search.sortLabel'))}
          <select id="sort-select">
            <option value="DEPARTURE">${Util.esc(t('search.sortDeparture'))}</option>
            <option value="PRICE_ASC">${Util.esc(t('search.sortPrice'))}</option>
            <option value="DURATION_ASC">${Util.esc(t('search.sortDuration'))}</option>
          </select>
        </label>
      </div>
      <div class="board" id="board"></div>
      <div style="text-align:center;margin-top:16px"><button class="btn btn-ghost" id="more-btn" style="display:none">+</button></div>
    `;

    this.renderMyTickets(root.querySelector('#tickets-slot'));

    const form = root.querySelector('#search-form');
    const board = root.querySelector('#board');
    const title = root.querySelector('#results-title');
    const moreBtn = root.querySelector('#more-btn');
    const sortSelect = root.querySelector('#sort-select');
    const legTabs = root.querySelector('#leg-tabs');
    const returnField = root.querySelector('#return-field');
    const tripHint = root.querySelector('#trip-hint');
    const departSel = form.elements.departDate;
    const returnSel = form.elements.returnDate;
    let offset = 0;
    let total = 0;
    let lastParams = {};
    let trip = 'oneway';
    let legs = [];
    let activeLeg = 0;
    let showingConnections = false;
    let connLimit = 10;
    const PAGE = 20;

    const dayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString(window.I18n.lang, { weekday: 'short', day: 'numeric', month: 'short' });

    // Solo se ofrecen los dias que realmente tienen vuelos (el dataset cubre dias sueltos, no un calendario continuo).
    const fillDates = async (select, origin, destination, minDate) => {
      const previous = select.value;
      let { dates } = await ApiClient.get('/api/flights/dates', { origin, destination });
      let anyLabel = t('search.anyDate');
      if (!dates.length && origin && destination) {
        // Sin vuelo directo: se ofrecen los dias de salida desde el origen, para buscar conexiones con escala.
        ({ dates } = await ApiClient.get('/api/flights/dates', { origin }));
        anyLabel = t('search.anyDateWithStop');
      }
      const usable = dates.filter((d) => !minDate || d.date >= minDate);
      select.innerHTML = `<option value="">${Util.esc(usable.length ? anyLabel : t('search.noDatesForRoute'))}</option>` +
        usable.map((d) => `<option value="${d.date}">${Util.esc(t('search.dateOption', { date: dayLabel(d.date), count: Util.number(d.count) }))}</option>`).join('');
      if (usable.some((d) => d.date === previous)) select.value = previous;
    };

    const refreshDates = async () => {
      const { origin, destination } = form.elements;
      try {
        await fillDates(departSel, origin.value, destination.value);
        if (trip === 'round') await fillDates(returnSel, destination.value, origin.value, departSel.value);
      } catch { /* los selectores quedan con lo ultimo que cargaron */ }
    };

    const setTrip = (value) => {
      trip = value;
      form.querySelectorAll('[data-trip]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.trip === value)));
      returnField.hidden = value !== 'round';
      tripHint.hidden = true;
      refreshDates();
    };

    const renderLegTabs = () => {
      legTabs.hidden = legs.length < 2;
      legTabs.innerHTML = legs.map((leg, i) => `
        <button type="button" role="tab" aria-selected="${i === activeLeg}" data-leg="${i}">
          ${i === 0 ? '✈' : '↩'} ${Util.esc(t(i === 0 ? 'search.legOutbound' : 'search.legReturn'))}
          <span class="mono">${leg.params.origin} → ${leg.params.destination}${leg.date ? ' · ' + Util.esc(dayLabel(leg.date)) : ''}</span>
        </button>`).join('');
      legTabs.querySelectorAll('[data-leg]').forEach((b) => {
        b.onclick = () => { activeLeg = Number(b.dataset.leg); lastParams = legs[activeLeg].params; renderLegTabs(); load(true); };
      });
    };

    const headHtml = `<div class="board__head">
        <span>${Util.esc(t('search.colFlight'))}</span><span>${Util.esc(t('search.colRoute'))}</span><span>${Util.esc(t('search.colDate'))}</span>
        <span>${Util.esc(t('search.colTime'))}</span><span>${Util.esc(t('search.colAircraft'))}</span><span>${Util.esc(t('search.colStatus'))}</span><span>${Util.esc(t('search.colPrice'))}</span></div>`;

    const rowHtml = (f) => `
      <div class="board__row" data-id="${f.id}" tabindex="0" role="link">
        <span class="flight-code col-1">${Util.flightNumber(f.id)}</span>
        <span class="route col-2">${f.origin} → ${f.destination}<div style="font-size:11.5px;font-weight:400;color:var(--slate-400)">${Util.esc((airports[f.origin] || {}).city)} — ${Util.esc((airports[f.destination] || {}).city)}</div></span>
        <span class="col-3 mono" style="font-size:13px">${f.date.slice(5)}</span>
        <span class="flight-time col-4">${f.time}<small>${Util.esc(t('search.durationValue', { hours: Util.number(f.timeHours) }))}</small></span>
        <span class="col-5" style="font-size:12.5px;color:#b8c6e2">${Util.esc(f.aircraftModel)}</span>
        <span class="col-6">${Util.statusBadge(f.status)}</span>
        <span class="col-7 mono" style="color:var(--amber-300);font-weight:600">${Util.money(f.priceEconomy)}</span>
      </div>`;

    const fmtDuration = (minutes) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
    const cityOf = (code) => (airports[code] || {}).city || code;

    const connectionLegHtml = (f) => `
      <div class="conn__leg">
        <span class="flight-code">${Util.flightNumber(f.id)}</span>
        <span class="route">${f.origin} → ${f.destination}<div class="conn__cities">${Util.esc(cityOf(f.origin))} — ${Util.esc(cityOf(f.destination))}</div></span>
        <span class="flight-time">${Util.esc(dayLabel(f.date))} · ${f.time}<small>${Util.esc(t('search.durationValue', { hours: Util.number(f.timeHours) }))} · ${Util.esc(f.aircraftModel)}</small></span>
        <span class="conn__price mono">${Util.money(f.priceEconomy)}</span>
      </div>`;

    const connectionHtml = (c) => `
      <div class="conn">
        ${connectionLegHtml(c.legs[0])}
        <div class="conn__layover">⏱ ${Util.esc(t('search.layover', { city: cityOf(c.hub), duration: fmtDuration(c.layoverMinutes) }))}</div>
        ${connectionLegHtml(c.legs[1])}
        <div class="conn__total">
          <span>${Util.esc(t('search.totalTrip', { duration: fmtDuration(c.totalMinutes) }))} · <strong class="mono">${Util.money(c.priceEconomy)}</strong></span>
          <a class="btn btn-accent btn-sm" href="#/connection/${encodeURIComponent(c.legs.map((f) => f.id).join(','))}">${Util.esc(t('search.buyItinerary'))}</a>
        </div>
      </div>`;

    // Si una ruta concreta no tiene vuelo directo, se sugieren itinerarios reales con 1 escala.
    const loadConnections = async () => {
      const { origin, destination, dateFrom, dateTo } = lastParams;
      const exactDay = dateFrom && dateFrom === dateTo;
      const data = await ApiClient.get('/api/flights/connections', {
        origin, destination, sort: sortSelect.value, limit: connLimit,
        date: exactDay ? dateFrom : undefined,
        dateFrom: exactDay ? undefined : dateFrom,
      });
      if (!data.total) {
        title.textContent = t('search.resultsCount', { count: 0 });
        board.innerHTML = `<div class="board-empty">${Util.esc(t('search.noConnections'))}</div>`;
        moreBtn.style.display = 'none';
        return;
      }
      title.textContent = t('search.connectionsCount', { count: Util.number(data.total) });
      board.innerHTML = `<div class="conn-intro">${Util.esc(t('search.noDirect', { origin, destination }))}
        <small>${Util.esc(t('search.legsBookedSeparately'))}</small></div>` + data.rows.map(connectionHtml).join('');
      moreBtn.style.display = data.total > data.rows.length ? 'inline-flex' : 'none';
      moreBtn.textContent = `+ ${Math.min(10, data.total - data.rows.length)}`;
    };

    const attachRowEvents = () => {
      board.querySelectorAll('.board__row').forEach((row) => {
        const go = () => { window.location.hash = `#/booking/${row.dataset.id}`; };
        row.onclick = go;
        row.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      });
    };

    const load = async (reset) => {
      if (reset) { offset = 0; connLimit = 10; showingConnections = false; board.innerHTML = headHtml + '<div class="board-empty">' + Util.esc(t('common.loading')) + '</div>'; }
      try {
        const data = await ApiClient.get('/api/flights', { ...lastParams, sort: sortSelect.value, limit: PAGE, offset });
        total = data.total;
        title.textContent = t('search.resultsCount', { count: Util.number(total) });
        if (reset) board.innerHTML = headHtml;
        if (total === 0 && lastParams.origin && lastParams.destination) {
          showingConnections = true;
          await loadConnections();
          return;
        } else if (total === 0) {
          board.innerHTML = headHtml + `<div class="board-empty">${Util.esc(t('search.noResults'))}</div>`;
        } else {
          board.insertAdjacentHTML('beforeend', data.rows.map(rowHtml).join(''));
          attachRowEvents();
        }
        offset += data.rows.length;
        moreBtn.style.display = offset < total ? 'inline-flex' : 'none';
        moreBtn.textContent = `+ ${Math.min(PAGE, total - offset)}`;
      } catch (err) {
        board.innerHTML = headHtml + `<div class="board-empty">${Util.esc(t('common.error'))}: ${Util.esc(err.message)}</div>`;
      }
    };

    form.querySelectorAll('[data-trip]').forEach((b) => { b.onclick = () => setTrip(b.dataset.trip); });
    form.elements.origin.addEventListener('change', refreshDates);
    form.elements.destination.addEventListener('change', refreshDates);
    departSel.addEventListener('change', () => {
      if (trip === 'round') fillDates(returnSel, form.elements.destination.value, form.elements.origin.value, departSel.value).catch(() => {});
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const origin = form.elements.origin.value;
      const destination = form.elements.destination.value;
      const depart = departSel.value;
      const ret = returnSel.value;
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
      if (trip === 'round' && (!origin || !destination)) { tripHint.hidden = false; return; }
      tripHint.hidden = true;
      legs = [{ date: depart, params: clean({ origin, destination, dateFrom: depart, dateTo: depart }) }];
      if (trip === 'round') {
        // La vuelta nunca puede salir antes que la ida.
        legs.push({ date: ret, params: clean({ origin: destination, destination: origin, dateFrom: ret || depart, dateTo: ret }) });
      }
      activeLeg = 0;
      lastParams = legs[0].params;
      renderLegTabs();
      load(true);
    });
    moreBtn.addEventListener('click', () => {
      if (!showingConnections) { load(false); return; }
      connLimit += 10;
      loadConnections().catch((err) => { board.innerHTML = `<div class="board-empty">${Util.esc(t('common.error'))}: ${Util.esc(err.message)}</div>`; });
    });
    sortSelect.addEventListener('change', () => load(true));

    refreshDates();
    load(true);
  },

  renderMyTickets(slot) {
    const t = window.t;
    const tickets = Util.myTickets.list();
    if (!tickets.length) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="panel" style="margin-bottom:22px">
        <h3 style="font-size:15px;margin-bottom:10px">🎫 ${Util.esc(t('receipt.title'))}</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${tickets.slice(0, 6).map((k) => `
            <a href="#/receipt/${Util.esc(k.txId)}" style="text-decoration:none" class="btn btn-ghost btn-sm">
              <span class="mono">${Util.esc(k.route)}</span> · ${Util.esc(k.seat)} · ${Util.esc(k.date)}
            </a>`).join('')}
        </div>
      </div>`;
  },
};
