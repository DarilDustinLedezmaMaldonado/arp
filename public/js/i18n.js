'use strict';

/* global window, document */

const SUPPORTED = ['es', 'en', 'pt', 'zh', 'fr'];
const LS_LANG = 'arp_lang';

const I18n = {
  lang: 'es',
  dict: {},
  listeners: [],

  detectInitialLang() {
    const saved = localStorage.getItem(LS_LANG);
    if (saved && SUPPORTED.includes(saved)) return saved;
    const nav = (navigator.language || 'es').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(nav) ? nav : 'es';
  },

  async load(lang) {
    const res = await fetch(`/locales/${lang}.json`);
    this.dict = await res.json();
    this.lang = lang;
    localStorage.setItem(LS_LANG, lang);
    document.documentElement.lang = lang;
    this.listeners.forEach((fn) => fn(lang));
  },

  async init() {
    await this.load(this.detectInitialLang());
  },

  onChange(fn) { this.listeners.push(fn); },

  t(path, vars) {
    const parts = path.split('.');
    let cur = this.dict;
    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
      else return path; // clave faltante: se muestra la ruta para detectarla facil
    }
    if (typeof cur !== 'string') return path;
    if (!vars) return cur;
    return cur.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
  },

  supported() { return SUPPORTED; },
  labelFor(lang) { return { es: 'Español', en: 'English', pt: 'Português', zh: '中文', fr: 'Français' }[lang]; },
};

window.I18n = I18n;
window.t = (path, vars) => I18n.t(path, vars);
