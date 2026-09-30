'use strict';

/* global window, ApiClient, Util, Html5Qrcode */

window.Views = window.Views || {};

window.Views.checkin = {
  async render(root) {
    const t = window.t;
    root.innerHTML = `
      <h1 class="view-title">${Util.esc(t('checkin.title'))}</h1>
      <p class="view-subtitle">${Util.esc(t('checkin.subtitle'))}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px;max-width:900px">
        <div class="panel">
          <div id="qr-reader" style="width:100%;min-height:260px;background:var(--navy-950);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#7d8fb3;font-size:13px;overflow:hidden">📷</div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-primary" id="scan-start">${Util.esc(t('checkin.scanButton'))}</button>
            <button class="btn btn-ghost" id="scan-stop" style="display:none">${Util.esc(t('checkin.stopScan'))}</button>
          </div>
        </div>
        <div class="panel">
          <div class="field"><label>${Util.esc(t('checkin.manualLabel'))}</label><input id="manual-code" class="mono" placeholder="${Util.esc(t('checkin.manualPlaceholder'))}"></div>
          <button class="btn btn-accent" id="manual-go">${Util.esc(t('checkin.submit'))}</button>
          <div id="checkin-result" style="margin-top:16px"></div>
        </div>
      </div>`;

    const resultEl = root.querySelector('#checkin-result');
    let scanner = null;
    let handling = false;

    const process = async (raw) => {
      if (handling) return;
      handling = true;
      try {
        const parts = String(raw).trim().split('|');
        if (parts[0] !== 'ARP' || !parts[1]) throw new Error(t('checkin.error'));
        const res = await ApiClient.post('/api/wallet/checkin', { txId: parts[1] });
        if (res.pendingSync) throw new Error(t('receipt.pendingConfirmation'));
        if (res.tx.status !== 'CHECKED_IN') throw new Error(t('receipt.rejected'));
        resultEl.innerHTML = `<div class="banner banner-ok"><strong>${Util.esc(t('checkin.success'))}</strong>
          <div class="mono" style="font-size:12px;margin-top:6px">${Util.esc(res.tx.seatNumber)} · ${Util.esc(res.tx.passengerName || '')} · ${Util.esc(res.tx.flightId)}</div></div>`;
        Util.toast(t('checkin.success'));
      } catch (err) {
        resultEl.innerHTML = `<div class="banner banner-error">${Util.esc(err.message)}</div>`;
      } finally {
        setTimeout(() => { handling = false; }, 2500);
      }
    };

    root.querySelector('#manual-go').onclick = () => process(root.querySelector('#manual-code').value);

    const stop = async () => {
      if (scanner) { try { await scanner.stop(); scanner.clear(); } catch { /* ya detenido */ } scanner = null; }
      root.querySelector('#scan-start').style.display = 'inline-flex';
      root.querySelector('#scan-stop').style.display = 'none';
    };

    root.querySelector('#scan-start').onclick = async () => {
      if (typeof Html5Qrcode === 'undefined') { Util.toast('html5-qrcode no cargó (¿sin internet?). Usa el código manual.', 'warn'); return; }
      try {
        scanner = new Html5Qrcode('qr-reader');
        await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (text) => process(text), () => {});
        root.querySelector('#scan-start').style.display = 'none';
        root.querySelector('#scan-stop').style.display = 'inline-flex';
      } catch (err) {
        Util.toast(String(err), 'error');
        scanner = null;
      }
    };
    root.querySelector('#scan-stop').onclick = stop;
    window.__viewCleanup = stop; // el router lo invoca al cambiar de vista para apagar la camara
  },
};
