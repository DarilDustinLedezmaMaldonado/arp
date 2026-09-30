'use strict';

/* global window, Util */

const SeatMap = (() => {
  function parseSeat(seatNumber) {
    const m = seatNumber.match(/^(\d+)([A-Z])$/);
    return { row: Number(m[1]), col: m[2] };
  }

  function cssFor(seat, selected) {
    if (selected) return 'seat seat-selected';
    switch (seat.status) {
      case 'AVAILABLE': return `seat seat-available${seat.cabinClass === 'FIRST' ? ' first' : ''}`;
      case 'SOLD': return 'seat seat-sold';
      case 'RESERVED': return 'seat seat-reserved';
      case 'REFUNDED': return 'seat seat-refunded';
      case 'CHECKED_IN': return 'seat seat-checked-in';
      default: return 'seat seat-sold';
    }
  }

  function tooltip(seat) {
    const parts = [`${seat.seatNumber} · ${window.t(seat.cabinClass === 'FIRST' ? 'booking.firstClassLabel' : 'booking.economyClassLabel')}`];
    if (seat.status !== 'AVAILABLE') parts.push(seat.status + (seat.passengerName ? ` — ${seat.passengerName}` : ''));
    else parts.push(Util.money(seat.price));
    if (seat.syncStatus === 'LOCAL_PENDING') parts.push('⏳ ' + window.t('receipt.syncPending'));
    return parts.join('\n');
  }

  function renderCabin(seats, cols, aisleAfter, selectedSeat, interactive) {
    const rows = new Map();
    seats.forEach((s) => {
      const { row, col } = parseSeat(s.seatNumber);
      if (!rows.has(row)) rows.set(row, {});
      rows.get(row)[col] = s;
    });
    let html = '';
    [...rows.keys()].sort((a, b) => a - b).forEach((row) => {
      html += `<div class="seat-row"><span class="seat-row-label">${row}</span>`;
      cols.forEach((col) => {
        const seat = rows.get(row)[col];
        if (!seat) {
          html += '<span class="seat" style="visibility:hidden"></span>';
        } else {
          const selected = selectedSeat === seat.seatNumber;
          const disabled = seat.status !== 'AVAILABLE';
          html += `<button type="button" class="${cssFor(seat, selected)}${seat.syncStatus === 'LOCAL_PENDING' ? ' seat-pending' : ''}" data-seat="${seat.seatNumber}" title="${Util.esc(tooltip(seat))}" ${disabled || !interactive ? 'disabled' : ''} aria-label="${Util.esc(tooltip(seat))}">${col}</button>`;
        }
        if (aisleAfter.includes(col)) html += '<span class="seat-aisle-gap"></span>';
      });
      html += '</div>';
    });
    return html;
  }

  /**
   * @param {HTMLElement} el
   * @param {{seats: object[], layout: {firstCols:string[],firstAisleAfter:string[],economyCols:string[],economyAisleAfter:string[]}, selected?: string, interactive?: boolean, onSelect?: (seat)=>void}} opts
   */
  function render(el, opts) {
    const { seats, layout, selected = null, interactive = true, onSelect } = opts;
    const first = seats.filter((s) => s.cabinClass === 'FIRST');
    const econ = seats.filter((s) => s.cabinClass === 'ECONOMY');

    el.innerHTML = `
      <div class="fuselage">
        <div style="text-align:center;font-size:11px;color:var(--slate-400);margin-bottom:4px">✈ ${Util.esc(window.t('booking.selectSeat'))}</div>
        <div class="cabin-divider">${Util.esc(window.t('booking.firstClassLabel'))}</div>
        ${renderCabin(first, layout.firstCols, layout.firstAisleAfter, selected, interactive)}
        <div class="cabin-divider">${Util.esc(window.t('booking.economyClassLabel'))}</div>
        <div class="seat-scroll" style="max-height:520px;overflow-y:auto;padding-right:6px">
          ${renderCabin(econ, layout.economyCols, layout.economyAisleAfter, selected, interactive)}
        </div>
      </div>
      <div class="seat-legend">
        <span><i class="legend-chip" style="background:#cdd8e8"></i>${Util.esc(window.t('seatLegend.available'))}</span>
        <span><i class="legend-chip" style="background:var(--gold-100);border:1px solid var(--amber-300)"></i>${Util.esc(window.t('seatLegend.availableFirst'))}</span>
        <span><i class="legend-chip" style="background:var(--rose-600)"></i>${Util.esc(window.t('seatLegend.sold'))}</span>
        <span><i class="legend-chip" style="background:var(--amber-500)"></i>${Util.esc(window.t('seatLegend.reserved'))}</span>
        <span><i class="legend-chip" style="background:var(--blue-700)"></i>${Util.esc(window.t('seatLegend.selected'))}</span>
        <span><i class="legend-chip" style="background:var(--green-600)"></i>${Util.esc(window.t('seatLegend.checkedIn'))}</span>
      </div>`;

    if (interactive && onSelect) {
      el.querySelectorAll('button.seat[data-seat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const seat = seats.find((s) => s.seatNumber === btn.dataset.seat);
          if (seat && seat.status === 'AVAILABLE') onSelect(seat);
        });
      });
    }
  }

  return { render };
})();

window.SeatMap = SeatMap;
