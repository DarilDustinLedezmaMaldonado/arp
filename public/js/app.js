'use strict';

/* global window, document, ApiClient, I18n, Util, Charts */

(() => {
  const ROUTES = [
    { re: /^#?\/?$/, nav: 'search', view: 'search' },
    { re: /^#\/booking\/([^/]+)$/, nav: 'search', view: 'booking', params: (m) => ({ flightId: decodeURIComponent(m[1]) }) },
    { re: /^#\/connection\/([^/]+)$/, nav: 'search', view: 'connection', params: (m) => ({ flightIds: decodeURIComponent(m[1]).split(',') }) },
    { re: /^#\/itinerary\/([^/]+)$/, nav: 'search', view: 'itinerary', params: (m) => ({ sagaId: decodeURIComponent(m[1]) }) },
    { re: /^#\/receipt\/([^/]+)$/, nav: 'search', view: 'receipt', params: (m) => ({ txId: decodeURIComponent(m[1]) }) },
    { re: /^#\/pass\/([^/]+)$/, nav: 'search', view: 'pass', params: (m) => ({ txId: decodeURIComponent(m[1]) }) },
    { re: /^#\/wallet$/, nav: 'wallet', view: 'wallet' },
    { re: /^#\/dashboard\/flight(?:\/([^/]+))?$/, nav: 'flightDashboard', view: 'flightDashboard', params: (m) => ({ flightId: m[1] ? decodeURIComponent(m[1]) : null }) },
    { re: /^#\/dashboard\/global$/, nav: 'globalDashboard', view: 'globalDashboard' },
    { re: /^#\/planner$/, nav: 'routePlanner', view: 'planner' },
    { re: /^#\/checkin$/, nav: 'checkin', view: 'checkin' },
    { re: /^#\/admin$/, nav: 'admin', view: 'admin' },
  ];

  const NAV = [
    { key: 'search', href: '#/' },
    { key: 'wallet', href: '#/wallet' },
    { key: 'routePlanner', href: '#/planner' },
    { key: 'flightDashboard', href: '#/dashboard/flight' },
    { key: 'globalDashboard', href: '#/dashboard/global' },
    { key: 'checkin', href: '#/checkin' },
    { key: 'admin', href: '#/admin' },
  ];

  let activeNav = 'search';

  function closeMobileNav() {
    document.querySelector('.app-header')?.classList.remove('nav-open');
    const toggle = document.getElementById('nav-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function renderNav() {
    document.getElementById('main-nav').innerHTML = NAV.map((n) =>
      `<a href="${n.href}" data-nav="${n.key}" class="${n.key === activeNav ? 'active' : ''}">${Util.esc(window.t('nav.' + n.key))}</a>`).join('');
    document.getElementById('brand-text').textContent = window.t('header.brand');
  }

  function renderSelectors() {
    const nodeSel = document.getElementById('node-select');
    nodeSel.innerHTML = ApiClient.nodes().map((n) =>
      `<option value="${n.id}" ${n.id === ApiClient.selectedId ? 'selected' : ''}>${Util.esc(window.t('common.selectNode'))}: ${Util.esc(n.flag + ' ' + n.label)}</option>`).join('');
    nodeSel.onchange = () => { ApiClient.select(nodeSel.value); route(); updateFooter(); };

    const langSel = document.getElementById('lang-select');
    langSel.innerHTML = I18n.supported().map((l) => `<option value="${l}" ${l === I18n.lang ? 'selected' : ''}>${I18n.labelFor(l)}</option>`).join('');
    langSel.onchange = async () => { await I18n.load(langSel.value); };
  }

  function updateFooter() {
    const n = ApiClient.selectedNode();
    document.getElementById('footer-node').textContent = `${n.label} · ${n.url}`;

    // Etiqueta visible del nodo activo: la barra de direcciones no cambia al elegir otro nodo.
    const badge = document.getElementById('node-badge');
    const url = new URL(n.url);
    badge.textContent = `${n.flag} ${n.id.replace(/^NODE_/, '')} · :${url.port || url.hostname}`;
    badge.classList.toggle('remote', url.origin !== window.location.origin);
    badge.title = window.t('header.nodeBadgeTitle', { node: n.label, url: n.url, origin: window.location.origin });
  }

  async function refreshDots() {
    const html = await Promise.all(ApiClient.nodes().map(async (n) => {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1400);
        const res = await fetch(`${n.url}/health`, { signal: ctl.signal });
        clearTimeout(timer);
        const h = await res.json();
        const bad = h.faultState.dbDown || h.faultState.networkPartitioned;
        return `<span class="node-dot ${bad ? 'down' : ''}" style="${bad ? 'background:var(--amber-500);box-shadow:0 0 0 3px rgba(242,161,4,.25)' : ''}" title="${Util.esc(n.label)}${bad ? ' (falla simulada)' : ''}"></span>`;
      } catch {
        return `<span class="node-dot down" title="${Util.esc(n.label)} (offline)"></span>`;
      }
    }));
    document.getElementById('node-dots').innerHTML = html.join('');
  }

  async function route() {
    closeMobileNav();
    Util.stopAllPollers();
    Charts.destroyAll();
    if (typeof window.__viewCleanup === 'function') { try { await window.__viewCleanup(); } catch { /* noop */ } window.__viewCleanup = null; }

    const hash = window.location.hash || '#/';
    const root = document.getElementById('view-root');
    const match = ROUTES.map((r) => ({ r, m: hash.match(r.re) })).find((x) => x.m);
    if (!match) { window.location.hash = '#/'; return; }
    activeNav = match.r.nav;
    renderNav();
    const params = match.r.params ? match.r.params(match.m) : {};
    root.innerHTML = `<p style="color:var(--slate-500)">${Util.esc(window.t('common.loading'))}</p>`;
    window.scrollTo(0, 0);
    try {
      await window.Views[match.r.view].render(root, params);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="banner banner-error">${Util.esc(window.t('common.error'))}: ${Util.esc(err.message)}
        <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="location.reload()">${Util.esc(window.t('common.retry'))}</button></div></div>`;
    }
  }

  async function boot() {
    await I18n.init();
    await ApiClient.init();
    renderSelectors();
    renderNav();
    const toggle = document.getElementById('nav-toggle');
    toggle.onclick = () => {
      const header = document.querySelector('.app-header');
      const open = header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    };
    document.getElementById('main-nav').addEventListener('click', (event) => {
      if (event.target.closest('a')) closeMobileNav();
    });
    window.addEventListener('resize', () => { if (window.innerWidth > 720) closeMobileNav(); });
    updateFooter();
    I18n.onChange(() => { renderSelectors(); renderNav(); updateFooter(); route(); });
    window.addEventListener('hashchange', route);
    refreshDots();
    setInterval(refreshDots, 4000);
    route();
  }

  boot();
})();
