'use strict';

/* global window, ApiClient, Util */

window.Views = window.Views || {};

function syncTag(tx) {
  const t = window.t;
  if (tx.status === 'CONFLICT_LOST') return `<span class="tag tag-conflict">${Util.esc(t('booking.conflictWarning').split('.')[0])}</span>`;
  return tx.syncStatus === 'LOCAL_PENDING'
    ? `<span class="tag tag-pending">⏳ ${Util.esc(t('receipt.syncPending'))}</span>`
    : `<span class="tag tag-synced">✓ ${Util.esc(t('receipt.syncOk'))}</span>`;
}

function statusLabel(status) {
  if (status === 'PENDING') return window.t('receipt.pendingConfirmation');
  if (status === 'REJECTED') return window.t('receipt.rejected');
  const map = { SOLD: 'seatLegend.sold', RESERVED: 'seatLegend.reserved', CHECKED_IN: 'seatLegend.checkedIn', REFUNDED: 'receipt.statusRefunded', RELEASED: 'receipt.statusReleased' };
  return map[status] ? window.t(map[status]) : status;
}

window.Views.receipt = {
  async render(root, { txId }) {
    const t = window.t;
    await Util.loadAirports();

    const draw = async () => {
      let data;
      try {
        data = await ApiClient.get(`/api/booking/tx/${txId}`);
      } catch (err) {
        root.innerHTML = `<div class="banner banner-warn">${Util.esc(t('receipt.notFound'))}</div>
          <a href="#/" class="btn btn-ghost">${Util.esc(t('common.back'))}</a>`;
        return;
      }
      const { tx: rawTx, flight, latest } = data;
      let tx = rawTx;
      // Los boletos son eventos "append-only": si ya hubo una operacion posterior sobre el mismo asiento, se refleja aqui.
      if (latest && latest.id !== rawTx.id && rawTx.syncStatus === 'SYNCED' && !['CONFLICT_LOST', 'REJECTED'].includes(rawTx.status)) {
        if (latest.basedOnTxId === rawTx.id && ['SOLD', 'CHECKED_IN'].includes(latest.status)) {
          window.location.hash = `#/receipt/${encodeURIComponent(latest.id)}`; // la reserva se convirtio en compra
          return;
        }
        tx = { ...rawTx, status: latest.basedOnTxId === rawTx.id && latest.status === 'REFUNDED' ? 'REFUNDED' : 'RELEASED', refundAvailableAt: latest.refundAvailableAt };
      }
      const o = Util.airport(flight.origin), d = Util.airport(flight.destination);
      const cls = t(tx.cabinClass === 'FIRST' ? 'booking.firstClassLabel' : 'booking.economyClassLabel');
      const active = tx.syncStatus === 'SYNCED' && latest?.id === tx.id && ['SOLD', 'RESERVED', 'CHECKED_IN'].includes(tx.status);

      root.innerHTML = `
        <h1 class="view-title">${Util.esc(t(tx.syncStatus !== 'SYNCED' ? 'receipt.pendingConfirmation' : 'receipt.title'))}</h1>
        <p class="view-subtitle" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span>${Util.esc(t('receipt.statusLabel'))}: <strong>${Util.esc(statusLabel(tx.status))}</strong></span> ${syncTag(tx)}
        </p>
        ${tx.syncStatus === 'LOCAL_PENDING' ? `<div class="banner banner-warn">${Util.esc(t('booking.pendingSyncWarning'))}</div>` : ''}
        ${tx.status === 'CONFLICT_LOST' ? `<div class="banner banner-error">${Util.esc(t('booking.conflictWarning'))}<div class="mono" style="font-size:11.5px;margin-top:6px">${Util.esc(tx.conflictReason || '')}</div></div>` : ''}
        ${tx.status === 'REFUNDED' ? `<div class="banner banner-ok">${Util.esc(t('receipt.refundNotice'))}</div>` : ''}

        <div class="ticket" style="max-width:820px${active ? '' : ';filter:grayscale(1);opacity:.6'}">
          <div class="ticket-main">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <strong style="font-family:var(--font-display);letter-spacing:.02em">${Util.esc(t('header.brand'))}</strong>
              <span class="mono" style="font-size:12px;color:#9db3dd">${Util.flightNumber(flight.id)}</span>
            </div>
            <div class="ticket-route"><span>${flight.origin}</span><span class="arrow">✈</span><span>${flight.destination}</span></div>
            <div style="display:flex;gap:70px"><span class="ticket-city">${Util.esc(o ? o.city : '')}</span><span class="ticket-city">${Util.esc(d ? d.city : '')}</span></div>
            <div class="ticket-grid">
              <div><div class="ticket-field-label">${Util.esc(t('search.colDate'))}</div><div class="ticket-field-value">${flight.date}</div></div>
              <div><div class="ticket-field-label">${Util.esc(t('search.colTime'))}</div><div class="ticket-field-value">${flight.time}</div></div>
              <div><div class="ticket-field-label">${Util.esc(t('receipt.gate'))}</div><div class="ticket-field-value">${Util.esc(flight.gate || '—')}</div></div>
              <div style="grid-column:span 2"><div class="ticket-field-label">${Util.esc(t('receipt.passenger'))}</div><div class="ticket-field-value">${Util.esc(tx.passengerName || '—')}</div></div>
              <div><div class="ticket-field-label">${Util.esc(t('receipt.class'))}</div><div class="ticket-field-value">${Util.esc(cls)}</div></div>
              <div><div class="ticket-field-label">${Util.esc(t('receipt.seat'))}</div><div class="ticket-field-value accent">${Util.esc(tx.seatNumber)}</div></div>
              <div><div class="ticket-field-label">${Util.esc(t('receipt.pnr'))}</div><div class="ticket-field-value accent">${Util.esc(tx.pnr || '——')}</div></div>
              <div><div class="ticket-field-label">${Util.esc(t('booking.priceLabel'))}</div><div class="ticket-field-value">${Util.money(tx.price)}</div></div>
            </div>
          </div>
          <div class="ticket-stub">
            ${active ? `<div class="ticket-qr"><img alt="QR" src="${ApiClient.absolute('/api/wallet/' + encodeURIComponent(tx.id) + '/qrcode.png')}"></div>` : `<p>${Util.esc(t('receipt.notValid'))}</p>`}
            <div class="mono" style="font-size:12px;font-weight:700">${flight.origin} → ${flight.destination}</div>
            <div style="font-size:10.5px;color:#8fa4cf">${Util.esc(t('checkin.subtitle').split('.')[0])}</div>
            <div class="mono" style="font-size:8.5px;color:#5c709c;word-break:break-all;margin-top:4px">${Util.esc(tx.id)}</div>
          </div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:22px" id="actions">
          ${active ? `<a class="btn btn-primary" target="_blank" rel="noopener" href="${ApiClient.absolute('/api/wallet/' + encodeURIComponent(tx.id) + '/pdf')}">⬇ ${Util.esc(t('receipt.downloadPdf'))}</a>
          <a class="btn btn-accent" href="#/pass/${encodeURIComponent(tx.id)}">📱 ${Util.esc(t('receipt.openWallet'))}</a>` : ''}
          ${tx.status === 'RESERVED' ? `
            <button class="btn btn-accent" id="convert-btn">${Util.esc(t('booking.purchaseAction'))}</button>
            <button class="btn btn-danger" id="cancel-btn">${Util.esc(t('receipt.cancelReservation'))}</button>` : ''}
          ${tx.status === 'SOLD' ? `<button class="btn btn-danger" id="refund-btn">${Util.esc(t('receipt.requestRefund'))}</button>` : ''}
          <a class="btn btn-ghost" href="#/dashboard/flight/${flight.id}">📊 ${Util.esc(t('nav.flightDashboard'))}</a>
        </div>`;

      const act = async (actionType) => {
        try {
          const actionResult = await ApiClient.post(`/api/booking/${tx.flightId}/${tx.seatNumber}/action`, {
            actionType, refTxId: tx.id, passengerName: tx.passengerName,
          });
          if (actionResult.pendingSync) {
            Util.toast(t('receipt.pendingConfirmation'), 'warn');
            window.location.hash = `#/receipt/${encodeURIComponent(actionResult.tx.id)}`;
            return;
          }
          if (['REJECTED', 'CONFLICT_LOST'].includes(actionResult.tx.status)) throw new Error(t('receipt.rejected'));
          // Tras comprar/cancelar/devolver se crea un evento NUEVO; el boleto sigue siendo el mismo asiento.
          if (actionType === 'PURCHASE') { const seat = await ApiClient.get(`/api/flights/${tx.flightId}/seatmap`); const s = seat.seats.find((x) => x.seatNumber === tx.seatNumber); if (s && s.txId) { Util.myTickets.add({ txId: s.txId, route: `${flight.origin}→${flight.destination}`, seat: tx.seatNumber, date: flight.date, flightId: flight.id }); window.location.hash = `#/receipt/${s.txId}`; return; } }
          Util.toast('OK');
          if (actionType === 'CANCEL' || actionType === 'REFUND') { Util.myTickets.remove(tx.id); window.location.hash = '#/'; return; }
          await draw();
        } catch (err) { Util.toast(err.message, 'error'); }
      };
      const b = (id, fn) => { const el = root.querySelector(id); if (el) el.onclick = fn; };
      b('#convert-btn', () => act('PURCHASE'));
      b('#cancel-btn', () => act('CANCEL'));
      b('#refund-btn', () => act('REFUND'));
    };

    await draw();
    Util.poll(draw, 4000); // refleja LOCAL_PENDING -> SYNCED cuando el nodo dueno se recupera
  },
};

window.Views.pass = {
  async render(root, { txId }) {
    const t = window.t;
    await Util.loadAirports();
    let data;
    try { data = await ApiClient.get(`/api/booking/tx/${txId}`); } catch (err) {
      root.innerHTML = `<div class="banner banner-warn">${Util.esc(t('receipt.notFound'))}</div>`;
      return;
    }
    const { tx, flight } = data;
    if (tx.syncStatus !== 'SYNCED' || !['SOLD', 'RESERVED', 'CHECKED_IN'].includes(tx.status) || (data.latest && data.latest.id !== tx.id)) {
      root.innerHTML = `<div class="banner banner-warn">${Util.esc(t('receipt.notValid'))}</div><a href="#/receipt/${encodeURIComponent(tx.id)}">${Util.esc(t('common.back'))}</a>`;
      return;
    }
    const o = Util.airport(flight.origin), d = Util.airport(flight.destination);
    let wallet = { applePkpass: false, googleWallet: false };
    try { wallet = await ApiClient.get('/api/wallet/status'); } catch { /* opcional */ }

    root.innerHTML = `
      <a href="#/receipt/${encodeURIComponent(tx.id)}" class="btn btn-ghost btn-sm" style="text-decoration:none;margin-bottom:18px">${Util.esc(t('common.back'))}</a>
      <div style="display:flex;justify-content:center">
        <div style="width:340px;background:linear-gradient(170deg,var(--blue-700),var(--navy-950) 75%);color:#fff;border-radius:22px;padding:22px 22px 26px;box-shadow:var(--shadow-panel);position:relative;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#c3d2f0">
            <strong style="font-family:var(--font-display);color:var(--amber-300)">Rafael Pabón</strong><span class="mono">${Util.flightNumber(flight.id)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 4px;font-family:var(--font-display);font-size:38px;font-weight:700">
            <span>${flight.origin}</span><span style="color:var(--amber-500);font-size:20px">✈</span><span>${flight.destination}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#a8bce3"><span>${Util.esc(o ? o.city : '')}</span><span>${Util.esc(d ? d.city : '')}</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin:22px 0">
            <div><div class="ticket-field-label">${Util.esc(t('search.colDate'))}</div><div class="ticket-field-value" style="font-size:13px">${flight.date.slice(5)}</div></div>
            <div><div class="ticket-field-label">${Util.esc(t('search.colTime'))}</div><div class="ticket-field-value">${flight.time}</div></div>
            <div><div class="ticket-field-label">${Util.esc(t('receipt.gate'))}</div><div class="ticket-field-value">${Util.esc(flight.gate || '—')}</div></div>
            <div style="grid-column:span 2"><div class="ticket-field-label">${Util.esc(t('receipt.passenger'))}</div><div class="ticket-field-value" style="font-size:14px">${Util.esc(tx.passengerName || '')}</div></div>
            <div><div class="ticket-field-label">${Util.esc(t('receipt.seat'))}</div><div class="ticket-field-value accent">${Util.esc(tx.seatNumber)}</div></div>
          </div>
          <div style="border-top:2px dashed rgba(255,255,255,.3);margin:0 -22px;position:relative">
            <span style="position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;background:var(--cloud-50)"></span>
            <span style="position:absolute;right:-11px;top:-11px;width:22px;height:22px;border-radius:50%;background:var(--cloud-50)"></span>
          </div>
          <div style="text-align:center;margin-top:22px">
            <div class="ticket-qr"><img alt="QR" style="width:180px;height:180px" src="${ApiClient.absolute('/api/wallet/' + encodeURIComponent(tx.id) + '/qrcode.png')}"></div>
            <div style="font-size:10px;color:#a8bce3">${Util.esc(t('wallet.boardingQr'))}</div>
            <div class="mono" style="margin-top:8px;font-size:13px;letter-spacing:.14em">${Util.esc(tx.pnr || '')}</div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px">
        ${wallet.googleWallet
          ? `<div style="display:flex;flex-direction:column;align-items:center;gap:8px"><a class="btn" style="background:#111;color:#fff" target="_blank" rel="noopener" href="${ApiClient.absolute('/api/wallet/' + encodeURIComponent(tx.id) + '/google')}">▰ ${Util.esc(t('wallet.addGoogle'))}</a>
            <details style="text-align:center"><summary style="cursor:pointer;font-size:12px">${Util.esc(t('wallet.scanGoogle'))}</summary><img alt="Google Wallet QR" style="width:220px;max-width:100%;margin-top:8px" src="${ApiClient.absolute('/api/wallet/' + encodeURIComponent(tx.id) + '/google-qrcode.png')}"><p style="font-size:11px;max-width:32ch">${Util.esc(t('wallet.googleQrHelp'))}</p></details></div>`
          : `<span style="font-size:12px;color:var(--slate-500);max-width:46ch;text-align:center">${Util.esc(t('wallet.googleSetup'))}</span>`}
        ${wallet.applePkpass
          ? `<a class="btn" style="background:#000;color:#fff" href="${ApiClient.absolute('/api/wallet/' + encodeURIComponent(tx.id) + '/pkpass')}">  Add to Apple Wallet</a>`
          : `<span style="font-size:12px;color:var(--slate-500);max-width:46ch;text-align:center">Apple Wallet (.pkpass) requiere certificados de Apple Developer — ver README (sección Wallet).</span>`}
        <a class="btn btn-primary" target="_blank" rel="noopener" href="${ApiClient.absolute('/api/wallet/' + encodeURIComponent(tx.id) + '/pdf')}">⬇ ${Util.esc(t('receipt.downloadPdf'))}</a>
      </div>`;
  },
};
