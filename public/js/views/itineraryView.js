'use strict';

/* global window, ApiClient, Util */

window.Views = window.Views || {};

const SAGA_ACTIVE = ['RESERVING', 'PURCHASING', 'COMPENSATING'];

/** Estado en vivo de una compra combinada (saga): pasos por tramo, compensaciones y registro. */
window.Views.itinerary = {
  async render(root, { sagaId }) {
    const t = window.t;
    await Util.loadAirports();

    // La saga vive en el nodo orquestador (el que aparece en su id), no necesariamente en el seleccionado.
    const orchestratorId = (sagaId.match(/^SAGA-(NODE_[A-Z]+)-/) || [])[1];
    const orchestrator = ApiClient.nodeById(orchestratorId);
    const base = orchestrator ? orchestrator.url : undefined;
    const dayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString(window.I18n.lang, { weekday: 'short', day: 'numeric', month: 'short' });
    const nodeLabel = (id) => { const n = ApiClient.nodeById(id); return n ? `${n.flag} ${n.label}` : id; };
    let stop = null;
    let savedTickets = false;

    const chip = (step, kind) => {
      if (!step) return `<span class="saga-chip idle">${Util.esc(t(`itinerary.step.${kind}`))} · —</span>`;
      const tone = { RESERVED: 'ok', SOLD: 'ok', AVAILABLE: 'undo', REFUNDED: 'undo', PENDING: 'wait', RETRY: 'wait' }[step.status] || 'bad';
      const name = kind === 'compensation' ? t(`itinerary.step.${step.actionType === 'REFUND' ? 'refund' : 'cancel'}`) : t(`itinerary.step.${kind}`);
      const statusText = t(`itinerary.stepStatus.${step.status}`);
      return `<span class="saga-chip ${tone}" title="${Util.esc(step.reason || step.txId || '')}">${Util.esc(name)} · ${Util.esc(statusText.startsWith('itinerary.') ? step.status : statusText)}</span>`;
    };

    const draw = async () => {
      let saga;
      try {
        saga = await ApiClient.get(`/api/itineraries/${encodeURIComponent(sagaId)}`, null, base);
      } catch (err) {
        root.innerHTML = `<div class="banner banner-warn">${Util.esc(t('itinerary.notFound'))}</div>
          <a href="#/" class="btn btn-ghost">${Util.esc(t('common.back'))}</a>`;
        if (stop) stop();
        return;
      }

      const active = SAGA_ACTIVE.includes(saga.status);
      const stops = saga.legs.map((l) => l.flight.origin).concat(saga.legs[saga.legs.length - 1].flight.destination);
      const remaining = Math.max(0, Math.ceil((Date.parse(saga.reserveDeadline) - Date.now()) / 1000));
      const tone = { COMPLETED: 'banner-ok', ABORTED: 'banner-error', COMPENSATING: 'banner-warn' }[saga.status] || 'banner-warn';
      const help = t(`itinerary.help.${saga.status}`, { seconds: remaining, count: saga.legs.length });

      if (saga.status === 'COMPLETED' && !savedTickets) {
        savedTickets = true;
        saga.legs.forEach((l) => Util.myTickets.add({
          txId: l.purchase.txId, route: `${l.flight.origin}→${l.flight.destination}`, seat: l.seatNumber,
          date: l.flight.date, flightId: l.flight.id,
        }));
      }

      root.innerHTML = `
        <a href="#/" class="btn btn-ghost btn-sm" style="text-decoration:none;margin-bottom:16px">${Util.esc(t('itinerary.backToSearch'))}</a>
        <div class="itin-head">
          <h1 class="view-title" style="margin:0">${stops.join(' → ')}</h1>
          <span class="itin-sub">${Util.esc(t('itinerary.pnr'))}: <strong class="mono">${Util.esc(saga.pnr)}</strong> · ${Util.esc(saga.passengerName)}</span>
        </div>
        <div class="banner ${tone}">
          <strong>${active ? '⏳ ' : ''}${Util.esc(t(`itinerary.status.${saga.status}`))}</strong>
          <div style="margin-top:4px">${Util.esc(help)}</div>
          ${saga.reason ? `<div style="margin-top:6px"><strong>${Util.esc(t('itinerary.reason'))}:</strong> ${Util.esc(saga.reason)}</div>` : ''}
        </div>
        <div class="saga-legs">
          ${saga.legs.map((l, i) => `
            <div class="panel saga-leg">
              <div class="saga-leg__head">
                <div><div class="itin-muted">${Util.esc(t('itinerary.legLabel', { n: i + 1 }))}</div>
                  <strong class="mono" style="font-size:18px">${l.flight.origin} → ${l.flight.destination}</strong>
                  <div class="itin-muted">${Util.flightNumber(l.flight.id)} · ${Util.esc(dayLabel(l.flight.date))} ${l.flight.time} · ${Util.esc(t('itinerary.seat', { seat: l.seatNumber }))}</div></div>
                <div class="itin-muted" style="text-align:right">${Util.esc(t('booking.ownerNode'))}<br><strong>${Util.esc(nodeLabel(l.ownerNode))}</strong></div>
              </div>
              <div class="saga-chips">${chip(l.reserve, 'reserve')}${chip(l.purchase, 'purchase')}${l.compensation ? chip(l.compensation, 'compensation') : ''}</div>
              ${saga.status === 'COMPLETED' ? `<a class="btn btn-accent btn-sm" style="text-decoration:none;margin-top:12px" href="#/receipt/${encodeURIComponent(l.purchase.txId)}">${Util.esc(t('itinerary.viewTicket'))}</a>` : ''}
            </div>`).join('')}
        </div>
        <div class="panel">
          <h3 style="font-size:15px;margin:0 0 4px">${Util.esc(t('itinerary.log'))}</h3>
          <div class="itin-muted" style="margin-bottom:10px">${Util.esc(t('itinerary.orchestrator'))}: ${Util.esc(nodeLabel(saga.orchestratorNode))}</div>
          <ol class="saga-log">
            ${saga.log.map((e) => `<li><span class="mono">${new Date(e.at).toLocaleTimeString(window.I18n.lang)} · L${e.lamportTs}</span> ${Util.esc(e.message)}</li>`).join('')}
          </ol>
        </div>`;

      if (!active && stop) { stop(); stop = null; }
    };

    await draw();
    const current = root.querySelector('.banner');
    if (current) stop = Util.poll(draw, 1500);
  },
};
