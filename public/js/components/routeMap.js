'use strict';

/* global window, Util, fetch */

/**
 * Carta de vuelo: mapa del mundo real (continentes y fronteras de Natural
 * Earth 1:110m, servido desde /vendor para funcionar sin internet) en
 * proyeccion equirectangular recortada a la zona de nuestros aeropuertos,
 * aeropuertos como puntos y una curva por cada ruta con un avion que la
 * recorre en bucle (SVG <animateMotion>).
 */
const RouteMap = (() => {
  const LON_MIN = -135, LON_MAX = 160, LAT_MAX = 68, LAT_MIN = -45;
  // Misma escala en ambos ejes para que los continentes no se deformen.
  const W = 1000, H = Math.round((W * (LAT_MAX - LAT_MIN)) / (LON_MAX - LON_MIN));
  let uid = 0;
  let worldSvg = null;
  let worldPromise = null;

  function project(lat, lon) {
    const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * W;
    const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;
    return [x, y];
  }

  function arcPath(a, b, lift = 0.22) {
    const [x1, y1] = a, [x2, y2] = b;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    // punto de control desplazado hacia "arriba" (norte) para dar sensacion de circulo maximo
    const cx = mx, cy = my - dist * lift;
    return { d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, cx, cy };
  }

  const toPath = (line, close) => line.map(([lon, lat], i) => {
    const [x, y] = project(lat, lon);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('') + (close ? 'Z' : '');

  /** Descarga (una sola vez) el mapa del mundo y lo convierte en trazos SVG ya proyectados. */
  function loadWorld() {
    if (!worldPromise) {
      worldPromise = fetch('/vendor/world-110m.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(({ rings, lines }) => {
          worldSvg = `<path d="${rings.map((r) => toPath(r, true)).join('')}" fill="#17345f" stroke="#2c5188" stroke-width="0.7" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
            `<path d="${lines.map((l) => toPath(l, false)).join('')}" fill="none" stroke="#3a619e" stroke-width="0.5" stroke-opacity="0.8" vector-effect="non-scaling-stroke"/>`;
          return worldSvg;
        })
        .catch(() => { worldPromise = null; return ''; }); // sin mapa se ve la grilla, como antes
    }
    return worldPromise;
  }

  function graticule() {
    let out = '';
    for (let lon = -120; lon <= 150; lon += 30) {
      const [x] = project(0, lon);
      out += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ffffff" stroke-opacity="0.05" vector-effect="non-scaling-stroke"/>`;
    }
    for (let lat = -30; lat <= 60; lat += 15) {
      const [, y] = project(lat, 0);
      out += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ffffff" stroke-opacity="${lat === 0 ? 0.12 : 0.05}" vector-effect="non-scaling-stroke"/>`;
    }
    return out;
  }

  /**
   * @param {HTMLElement} el contenedor
   * @param {{routes: {from:string,to:string,highlight?:boolean}[], airports: object, showAll?: boolean, animate?: boolean, caption?: string, fit?: boolean}} opts
   *   fit: acerca el mapa a las rutas dibujadas (por defecto, cuando no se muestran todos los aeropuertos).
   */
  function render(el, opts) {
    const { routes, airports, showAll = true, animate = true } = opts;
    const fit = opts.fit !== undefined ? opts.fit : !showAll;
    const id = ++uid;
    const used = new Set();
    routes.forEach((r) => { used.add(r.from); used.add(r.to); });

    // Ventana visible: todo el mapa, o un recuadro alrededor de las rutas (misma proporcion W:H).
    let vb = [0, 0, W, H];
    if (fit && used.size) {
      const pts = [];
      routes.forEach((r) => {
        const A = airports[r.from], B = airports[r.to];
        if (!A || !B) return;
        const pA = project(A.lat, A.lon), pB = project(B.lat, B.lon);
        const { cx, cy } = arcPath(pA, pB);
        pts.push(pA, pB, [cx, (cy + (pA[1] + pB[1]) / 2) / 2]);
      });
      if (pts.length) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        let w = Math.max(Math.max(...xs) - Math.min(...xs), 1) * 1.35;
        let h = Math.max(Math.max(...ys) - Math.min(...ys), 1) * 1.6;
        w = Math.max(w, h * (W / H), W * 0.28);
        w = Math.min(w, W);
        h = w * (H / W);
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
        const x = Math.min(Math.max(cx - w / 2, 0), W - w), y = Math.min(Math.max(cy - h / 2, 0), H - h);
        vb = [x, y, w, h];
      }
    }
    const k = vb[2] / W; // al acercar, letras, puntos y avion se reducen para verse del mismo tamano

    let svg = `<svg viewBox="${vb.map((v) => v.toFixed(1)).join(' ')}" width="100%" role="img" aria-label="${Util.esc(opts.caption || 'Mapa de rutas')}" style="display:block">`;
    svg += `<defs>
      <linearGradient id="rm-sky-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0c2149"/><stop offset="1" stop-color="#0a1930"/></linearGradient>
      <radialGradient id="rm-glow-${id}"><stop offset="0" stop-color="#f2a104" stop-opacity="0.9"/><stop offset="1" stop-color="#f2a104" stop-opacity="0"/></radialGradient>
    </defs>`;
    svg += `<rect width="${W}" height="${H}" fill="url(#rm-sky-${id})" rx="10"/>`;
    svg += graticule();
    svg += `<g data-world="${id}">${worldSvg || ''}</g>`;

    // rutas
    routes.forEach((r, i) => {
      const A = airports[r.from], B = airports[r.to];
      if (!A || !B) return;
      const pA = project(A.lat, A.lon), pB = project(B.lat, B.lon);
      const { d } = arcPath(pA, pB);
      const pid = `rm-path-${id}-${i}`;
      const strong = r.highlight !== false;
      svg += `<path id="${pid}" d="${d}" fill="none" stroke="${strong ? '#f2a104' : '#5d7fb8'}" stroke-width="${(strong ? 2.4 : 1) * k}" stroke-opacity="${strong ? 0.95 : 0.35}" ${strong ? `stroke-dasharray="${7 * k} ${6 * k}"` : ''}/>`;
      if (animate && strong) {
        const dur = Math.max(4, Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) / (70 * k));
        svg += `<g><g transform="rotate(90) scale(${k})"><g transform="translate(-13,-13) scale(1.08)">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="#ffffff" stroke="#0a1930" stroke-width="0.6"/>
        </g></g>
        <animateMotion dur="${dur.toFixed(1)}s" repeatCount="indefinite" rotate="auto"><mpath href="#${pid}"/></animateMotion></g>`;
      }
    });

    // aeropuertos
    Object.entries(airports).forEach(([code, a]) => {
      if (!showAll && !used.has(code)) return;
      const [x, y] = project(a.lat, a.lon);
      const active = used.has(code);
      if (active) svg += `<circle cx="${x}" cy="${y}" r="${16 * k}" fill="url(#rm-glow-${id})"/>`;
      svg += `<circle cx="${x}" cy="${y}" r="${(active ? 4.6 : 3) * k}" fill="${active ? '#ffcb66' : '#8fa8d6'}"/>`;
      svg += `<text x="${x + 8 * k}" y="${y - 7 * k}" fill="${active ? '#ffffff' : '#8fa8d6'}" font-family="JetBrains Mono, monospace" font-size="${(active ? 13 : 10.5) * k}" font-weight="${active ? 700 : 500}" paint-order="stroke" stroke="#0a1930" stroke-width="${3 * k}" stroke-opacity="0.7">${code}</text>`;
    });

    svg += '</svg>';
    el.innerHTML = svg;
    if (!worldSvg) {
      loadWorld().then((world) => {
        const g = el.querySelector(`g[data-world="${id}"]`);
        if (g) g.innerHTML = world;
      });
    }
  }

  return { render, project, loadWorld };
})();

window.RouteMap = RouteMap;
