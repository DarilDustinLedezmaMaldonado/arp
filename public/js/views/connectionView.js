'use strict';

/* global window, ApiClient, Util, SeatMap, RouteMap */

window.Views = window.Views || {};

/** Compra combinada de un itinerario con escala: un asiento por tramo y una sola compra (saga). */
window.Views.connection = {
  async render(root, { flightIds }) {
    const t = window.t;
    await Util.loadAirports();
    const aircraft = await ApiClient.get('/api/aircraft');

    let legs;
    try {
      legs = (await Promise.all(flightIds.map((id) => ApiClient.get(`/api/flights/${encodeURIComponent(id)}/seatmap`))))
        .map((d) => ({ flight: d.flight, seats: d.seats, selected: null }));
    } catch (err) {
      root.innerHTML = `<div class="banner banner-error">${Util.esc(err.message)}</div><a class="btn btn-ghost" href="#/">${Util.esc(t('booking.back'))}</a>`;
      return;
    }

    const cityOf = (code) => (Util.airport(code) || {}).city || code;
    const stops = legs.map((l) => l.flight.origin).concat(legs[legs.length - 1].flight.destination);
    const dayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString(window.I18n.lang, { weekday: 'short', day: 'numeric', month: 'short' });
    const at = (f) => Date.parse(`${f.date}T${f.time}:00Z`);
    const layoverMin = (a, b) => Math.round((at(b) - (at(a) + a.timeHours * 3600000)) / 60000);
    const fmtDuration = (m) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
    let active = 0;
    let busy = false;
    let notice = '';
    let paxName = '';
    let paxEmail = '';

    root.innerHTML = `
      <a href="#/" class="btn btn-ghost btn-sm" style="text-decoration:none;margin-bottom:16px">${Util.esc(t('booking.back'))}</a>
      <div class="itin-head">
        <h1 class="view-title" style="margin:0">${stops.join(' → ')}</h1>
        <span class="itin-sub">${Util.esc(t('itinerary.subtitle', { count: legs.length }))}</span>
      </div>
      <div class="itin-grid">
        <div>
          <div class="leg-tabs" id="itin-tabs" role="tablist"></div>
          <div class="itin-leg-head" id="itin-leg-head"></div>
          <div id="seatmap-slot"></div>
        </div>
        <aside class="itin-aside">
          <div class="route-map" style="padding:0;margin-bottom:16px" id="route-slot"></div>
          <div class="panel" id="side-panel"></div>
        </aside>
      </div>`;

    RouteMap.render(root.querySelector('#route-slot'), {
      routes: legs.map((l) => ({ from: l.flight.origin, to: l.flight.destination })),
      airports: Util.airportData.airports,
      showAll: false,
      caption: stops.join(' → '),
    });

    const tabs = root.querySelector('#itin-tabs');
    const legHead = root.querySelector('#itin-leg-head');
    const seatSlot = root.querySelector('#seatmap-slot');
    const sidePanel = root.querySelector('#side-panel');

    const ownerLabel = (f) => {
      const n = ApiClient.nodeById(f.ownerNode);
      return n ? `${n.flag} ${n.label}` : f.ownerNode;
    };

    const drawTabs = () => {
      tabs.innerHTML = legs.map((l, i) => `
        <button type="button" role="tab" aria-selected="${i === active}" data-leg="${i}">
          ${Util.esc(t('itinerary.legLabel', { n: i + 1 }))}
          <span class="mono">${l.flight.origin} → ${l.flight.destination}</span>
          <span class="itin-tab-seat">${l.selected ? `✓ ${Util.esc(l.selected.seatNumber)}` : '·'}</span>
        </button>`).join('');
      tabs.querySelectorAll('[data-leg]').forEach((b) => {
        b.onclick = () => { active = Number(b.dataset.leg); drawAll(); };
      });
      const f = legs[active].flight;
      legHead.innerHTML = `<span class="mono">${Util.flightNumber(f.id)}</span> · ${Util.esc(dayLabel(f.date))} ${f.time} ·
        ${Util.esc(aircraft.models[f.aircraftModel].name)} · ${Util.esc(t('booking.ownerNode'))}: <strong>${Util.esc(ownerLabel(f))}</strong>`;
    };

    const drawSeats = () => {
      const scrollEl = seatSlot.querySelector('.seat-scroll');
      const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      const leg = legs[active];
      SeatMap.render(seatSlot, {
        seats: leg.seats,
        layout: aircraft.seatLayout[leg.flight.aircraftModel],
        selected: leg.selected && leg.selected.seatNumber,
        interactive: !busy,
        onSelect: (s) => {
          leg.selected = s;
          // Pasa solo al siguiente tramo que aun no tiene asiento.
          const next = legs.findIndex((l) => !l.selected);
          if (next !== -1) active = next;
          drawAll();
        },
      });
      const again = seatSlot.querySelector('.seat-scroll');
      if (again && legs[active] === leg) again.scrollTop = scrollTop;
    };

    const drawSide = () => {
      const nameEl = sidePanel.querySelector('#pax-name');
      const emailEl = sidePanel.querySelector('#pax-email');
      if (nameEl) paxName = nameEl.value;
      if (emailEl) paxEmail = emailEl.value;
      const missing = legs.filter((l) => !l.selected).length;
      const total = legs.reduce((sum, l) => sum + (l.selected ? l.selected.price : 0), 0);
      const rows = legs.map((l, i) => {
        const f = l.flight;
        const layover = i > 0 ? `<div class="itin-layover">⏱ ${Util.esc(t('search.layover', { city: cityOf(f.origin), duration: fmtDuration(layoverMin(legs[i - 1].flight, f)) }))}</div>` : '';
        return `${layover}
          <div class="itin-leg-row">
            <div><strong class="mono">${f.origin} → ${f.destination}</strong>
              <div class="itin-muted">${Util.flightNumber(f.id)} · ${Util.esc(dayLabel(f.date))} ${f.time}</div></div>
            <div style="text-align:right">
              ${l.selected
    ? `<div class="mono" style="font-weight:700">${Util.esc(l.selected.seatNumber)}</div><div class="itin-muted">${Util.money(l.selected.price)}</div>`
    : `<button class="btn btn-ghost btn-sm" data-pick="${i}">${Util.esc(t('itinerary.pickSeat'))}</button>`}
            </div>
          </div>`;
      }).join('');
      sidePanel.innerHTML = `
        ${notice}
        ${rows}
        <div class="itin-total"><span>${Util.esc(t('itinerary.total'))}</span><strong class="mono">${Util.money(total)}</strong></div>
        <div class="field"><label>${Util.esc(t('booking.passengerName'))}</label><input id="pax-name" autocomplete="name" placeholder="Ana Martínez"></div>
        <div class="field"><label>${Util.esc(t('booking.passengerEmail'))}</label><input id="pax-email" type="email" autocomplete="email"></div>
        <button class="btn btn-accent" id="buy-btn" style="width:100%" ${busy || missing ? 'disabled' : ''}>
          ${Util.esc(busy ? t('itinerary.buying') : missing ? t('itinerary.missingSeats', { count: missing }) : t('itinerary.buy'))}</button>
        <p class="itin-note">${Util.esc(t('itinerary.sagaNote'))}</p>`;
      sidePanel.querySelector('#pax-name').value = paxName;
      sidePanel.querySelector('#pax-email').value = paxEmail;
      sidePanel.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { active = Number(b.dataset.pick); drawAll(); }; });
      sidePanel.querySelector('#buy-btn').onclick = submit;
    };

    const drawAll = () => { drawTabs(); drawSeats(); drawSide(); };

    const submit = async () => {
      const name = sidePanel.querySelector('#pax-name').value.trim();
      const email = sidePanel.querySelector('#pax-email').value.trim();
      if (!name) { Util.toast(t('booking.passengerName') + ' *', 'warn'); sidePanel.querySelector('#pax-name').focus(); return; }
      busy = true;
      notice = '';
      drawAll();
      try {
        const saga = await ApiClient.post('/api/itineraries', {
          legs: legs.map((l) => ({ flightId: l.flight.id, seatNumber: l.selected.seatNumber })),
          passengerName: name,
          passengerEmail: email || undefined,
        });
        window.location.hash = `#/itinerary/${encodeURIComponent(saga.id)}`;
      } catch (err) {
        busy = false;
        notice = `<div class="banner banner-error">${Util.esc(err.message)}</div>`;
        await refresh();
        drawAll();
      }
    };

    const refresh = async () => {
      if (busy) return;
      const fresh = await Promise.all(legs.map((l) => ApiClient.get(`/api/flights/${encodeURIComponent(l.flight.id)}/seatmap`)));
      let changed = false;
      fresh.forEach((d, i) => {
        legs[i].seats = d.seats;
        const sel = legs[i].selected;
        if (sel) {
          const still = d.seats.find((x) => x.seatNumber === sel.seatNumber);
          if (!still || still.status !== 'AVAILABLE') { legs[i].selected = null; changed = true; }
        }
      });
      drawSeats();
      if (changed) { drawTabs(); drawSide(); }
    };

    drawAll();
    Util.poll(refresh, 4000);
  },
};
