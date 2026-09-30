'use strict';

/* global window, ApiClient, Util, SeatMap, RouteMap */

window.Views = window.Views || {};

window.Views.booking = {
  async render(root, { flightId }) {
    const t = window.t;
    await Util.loadAirports();
    const aircraft = await ApiClient.get('/api/aircraft');

    root.innerHTML = `<p style="color:var(--slate-500)">${Util.esc(t('common.loading'))}</p>`;

    let data;
    try {
      data = await ApiClient.get(`/api/flights/${flightId}/seatmap`);
    } catch (err) {
      root.innerHTML = `<div class="banner banner-error">${Util.esc(err.message)}</div><a class="btn btn-ghost" href="#/">${Util.esc(t('booking.back'))}</a>`;
      return;
    }

    const { flight } = data;
    const layout = aircraft.seatLayout[flight.aircraftModel];
    const modelName = aircraft.models[flight.aircraftModel].name;
    const owner = ApiClient.nodeById(flight.ownerNode);
    let seats = data.seats;
    let selectedSeat = null;
    let busy = false;
    const onSale = ['SCHEDULED', 'DELAYED'].includes(flight.status);

    root.innerHTML = `
      <a href="#/" class="btn btn-ghost btn-sm" style="text-decoration:none;margin-bottom:16px">${Util.esc(t('booking.back'))}</a>
      <div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,1fr);gap:26px;align-items:start" id="booking-grid">
        <div>
          <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:14px;flex-wrap:wrap">
            <h1 class="view-title" style="margin:0">${flight.origin} → ${flight.destination}</h1>
            <span class="mono" style="color:var(--slate-500)">${Util.flightNumber(flight.id)} · ${flight.date} ${flight.time} · ${Util.esc(modelName)}</span>
            <span style="background:var(--navy-950);padding:2px;border-radius:999px;display:inline-flex">${Util.statusBadge(flight.status)}</span>
          </div>
          <div id="seatmap-slot"></div>
        </div>
        <aside style="position:sticky;top:96px">
          <div class="route-map" style="padding:0;margin-bottom:16px" id="route-slot"></div>
          <div class="panel" id="side-panel"></div>
        </aside>
      </div>`;

    RouteMap.render(root.querySelector('#route-slot'), {
      routes: [{ from: flight.origin, to: flight.destination }],
      airports: Util.airportData.airports,
      showAll: false,
      caption: `${flight.origin} → ${flight.destination}`,
    });

    const seatSlot = root.querySelector('#seatmap-slot');
    const sidePanel = root.querySelector('#side-panel');

    const drawSeats = () => {
      const scrollEl = seatSlot.querySelector('.seat-scroll');
      const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      SeatMap.render(seatSlot, {
        seats, layout, selected: selectedSeat && selectedSeat.seatNumber, interactive: !busy && onSale,
        onSelect: (s) => { selectedSeat = s; drawSeats(); drawSide(); },
      });
      const again = seatSlot.querySelector('.seat-scroll');
      if (again) again.scrollTop = scrollTop;
    };

    let notice = onSale ? '' : `<div class="banner banner-warn">${Util.esc(t('booking.notSellable', { status: t('flightStatus.' + flight.status) }))}</div>`;
    const drawSide = () => {
      const s = selectedSeat;
      sidePanel.innerHTML = `
        ${notice}
        <div style="font-size:12px;color:var(--slate-500);margin-bottom:12px">
          ${Util.esc(t('booking.ownerNode'))}: <strong>${Util.esc(owner ? owner.flag + ' ' + owner.label : flight.ownerNode)}</strong>
        </div>
        ${s ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <div><div style="font-size:11.5px;color:var(--slate-500)">${Util.esc(t('booking.seatSelected'))}</div>
              <div class="mono" style="font-size:26px;font-weight:700">${s.seatNumber}</div>
              <div style="font-size:12.5px;color:var(--slate-500)">${Util.esc(t(s.cabinClass === 'FIRST' ? 'booking.firstClassLabel' : 'booking.economyClassLabel'))}</div></div>
            <div style="text-align:right"><div style="font-size:11.5px;color:var(--slate-500)">${Util.esc(t('booking.priceLabel'))}</div>
              <div class="mono" style="font-size:24px;font-weight:700;color:#b3760a">${Util.money(s.price)}</div></div>
          </div>
          <div class="field"><label>${Util.esc(t('booking.passengerName'))}</label><input id="pax-name" autocomplete="name" placeholder="Ana Martínez"></div>
          <div class="field"><label>${Util.esc(t('booking.passengerEmail'))}</label><input id="pax-email" type="email" autocomplete="email"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-accent" id="buy-btn" ${busy ? 'disabled' : ''}>${Util.esc(busy ? t('booking.processing') : t('booking.purchaseAction'))}</button>
            <button class="btn btn-ghost" id="reserve-btn" ${busy ? 'disabled' : ''}>${Util.esc(t('booking.reserveAction'))}</button>
          </div>` : `<p style="color:var(--slate-500);font-size:14px;margin:0">${Util.esc(t('booking.noSeatSelected'))}</p>`}
      `;
      if (s) {
        sidePanel.querySelector('#buy-btn').onclick = () => submit('PURCHASE');
        sidePanel.querySelector('#reserve-btn').onclick = () => submit('RESERVE');
      }
    };

    const submit = async (actionType) => {
      const name = sidePanel.querySelector('#pax-name').value.trim();
      const email = sidePanel.querySelector('#pax-email').value.trim();
      if (!name) { Util.toast(t('booking.passengerName') + ' *', 'warn'); sidePanel.querySelector('#pax-name').focus(); return; }
      busy = true; drawSide(); drawSeats();
      try {
        const result = await ApiClient.post(`/api/booking/${flightId}/${selectedSeat.seatNumber}/action`, {
          actionType, passengerName: name, passengerEmail: email || undefined,
        });
        if (result.tx.status === 'CONFLICT_LOST') {
          notice = `<div class="banner banner-error">${Util.esc(t('booking.conflictWarning'))}</div>`;
          selectedSeat = null;
          busy = false;
          await refresh();
          return;
        }
        Util.myTickets.add({
          txId: result.tx.id, route: `${flight.origin}→${flight.destination}`, seat: result.tx.seatNumber,
          date: flight.date, flightId: flight.id,
        });
        if (result.pendingSync) Util.toast(t('booking.pendingSyncWarning'), 'warn');
        window.location.hash = `#/receipt/${result.tx.id}`;
      } catch (err) {
        busy = false;
        notice = `<div class="banner banner-error">${Util.esc(err.message)}</div>`;
        selectedSeat = null;
        await refresh();
      }
    };

    const refresh = async () => {
      if (busy) return;
      const fresh = await ApiClient.get(`/api/flights/${flightId}/seatmap`);
      seats = fresh.seats;
      if (selectedSeat) {
        const still = seats.find((x) => x.seatNumber === selectedSeat.seatNumber);
        if (!still || still.status !== 'AVAILABLE') selectedSeat = null;
      }
      drawSeats();
      if (!selectedSeat) drawSide();
    };

    drawSeats();
    drawSide();
    // los cambios hechos en OTROS nodos aparecen solos (gossip + replica local)
    Util.poll(refresh, 4000);
  },
};
