'use strict';

/* global window, Util */

window.Views = window.Views || {};

window.Views.wallet = {
  async render(root) {
    const t = window.t;
    const tickets = Util.myTickets.list();

    root.innerHTML = `
      <section class="wallet-hero">
        <div>
          <div class="hero__eyebrow">${Util.esc(t('wallet.eyebrow'))}</div>
          <h1>${Util.esc(t('wallet.title'))}</h1>
          <p>${Util.esc(t('wallet.subtitle'))}</p>
        </div>
        <div class="wallet-hero__icon" aria-hidden="true">▣</div>
      </section>
      ${tickets.length ? `
        <div class="wallet-list">
          ${tickets.map((ticket) => `
            <a class="wallet-ticket" href="#/receipt/${encodeURIComponent(ticket.txId)}">
              <span class="wallet-ticket__route">${Util.esc(ticket.route)}</span>
              <span><small>${Util.esc(t('receipt.seat'))}</small><strong>${Util.esc(ticket.seat)}</strong></span>
              <span><small>${Util.esc(t('search.colDate'))}</small><strong>${Util.esc(ticket.date)}</strong></span>
              <span class="wallet-ticket__action">${Util.esc(t('wallet.open'))} →</span>
            </a>`).join('')}
        </div>` : `
        <div class="wallet-empty">
          <div class="wallet-empty__icon">🎫</div>
          <h2>${Util.esc(t('wallet.emptyTitle'))}</h2>
          <p>${Util.esc(t('wallet.emptyText'))}</p>
          <a class="btn btn-accent" href="#/">${Util.esc(t('wallet.searchFlights'))}</a>
        </div>`}
    `;
  },
};
