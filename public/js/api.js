'use strict';

/* global window */

const LS_KEY = 'arp_selected_node_id';

const ApiClient = {
  adminSecret: '',
  adminHeaders(path) { return path.startsWith('/api/admin/') && this.adminSecret ? { 'X-Admin-Secret': this.adminSecret } : {}; },
  selfId: null,
  nodeList: [],
  selectedId: null,

  async init() {
    // Todos los nodos sirven esta misma interfaz; /api/network dice quien soy y donde estan los demas.
    try {
      const res = await fetch(`${window.location.origin}/api/network`);
      const data = await res.json();
      this.selfId = data.self;
      this.nodeList = data.nodes;
    } catch (err) {
      this.nodeList = [{ id: 'SELF', label: 'Este nodo', flag: '🛫', url: window.location.origin }];
      this.selfId = 'SELF';
    }
    const saved = localStorage.getItem(LS_KEY);
    this.selectedId = this.nodeList.some((n) => n.id === saved) ? saved : this.selfId;
  },

  nodes() { return this.nodeList; },
  selectedNode() { return this.nodeList.find((n) => n.id === this.selectedId) || this.nodeList[0]; },
  nodeById(id) { return this.nodeList.find((n) => n.id === id); },

  select(id) {
    this.selectedId = id;
    localStorage.setItem(LS_KEY, id);
  },

  baseUrl() { return this.selectedNode().url; },

  async _handle(res) {
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const err = new Error((body && body.message) || `Error HTTP ${res.status}`);
      err.status = res.status;
      err.code = body && body.error;
      throw err;
    }
    return body;
  },

  _url(base, path, params) {
    const url = new URL(base + path);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
    return url.toString();
  },

  async get(path, params, baseOverride) {
    const res = await fetch(this._url(baseOverride || this.baseUrl(), path, params), { headers: this.adminHeaders(path) });
    return this._handle(res);
  },

  async post(path, body, baseOverride) {
    const res = await fetch((baseOverride || this.baseUrl()) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.adminHeaders(path) },
      body: JSON.stringify(body || {}),
    });
    return this._handle(res);
  },

  /** URL absoluta a un recurso del nodo seleccionado (PDF, QR...). */
  absolute(path) { return this.baseUrl() + path; },
};

window.ApiClient = ApiClient;
