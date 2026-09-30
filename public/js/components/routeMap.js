'use strict';

/* global window, Util */

/**
 * Carta de vuelo estilizada (sin necesidad de datos geograficos): proyeccion
 * equirectangular recortada a la zona donde estan nuestros aeropuertos,
 * grilla de latitud/longitud, aeropuertos como puntos y una curva por cada
 * ruta con un avion que la recorre en bucle (SVG <animateMotion>).
 */
const RouteMap = (() => {
  const W = 1000, H = 460;
  const LON_MIN = -135, LON_MAX = 155, LAT_MAX = 66, LAT_MIN = -38;
  let uid = 0;

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

  function graticule() {
    let out = '';
    for (let lon = -120; lon <= 150; lon += 30) {
      const [x] = project(0, lon);
      out += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ffffff" stroke-opacity="0.05"/>`;
    }
    for (let lat = -30; lat <= 60; lat += 15) {
      const [, y] = project(lat, 0);
      out += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ffffff" stroke-opacity="${lat === 0 ? 0.12 : 0.05}"/>`;
    }
    return out;
  }

  /**
   * @param {HTMLElement} el contenedor
   * @param {{routes: {from:string,to:string,highlight?:boolean}[], airports: object, showAll?: boolean, animate?: boolean, caption?: string}} opts
   */
  function render(el, opts) {
    const { routes, airports, showAll = true, animate = true } = opts;
    const id = ++uid;
    const used = new Set();
    routes.forEach((r) => { used.add(r.from); used.add(r.to); });

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${Util.esc(opts.caption || 'Mapa de rutas')}" style="display:block">`;
    svg += `<defs>
      <linearGradient id="rm-sky-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0c2149"/><stop offset="1" stop-color="#0a1930"/></linearGradient>
      <radialGradient id="rm-glow-${id}"><stop offset="0" stop-color="#f2a104" stop-opacity="0.9"/><stop offset="1" stop-color="#f2a104" stop-opacity="0"/></radialGradient>
    </defs>`;
    svg += `<rect width="${W}" height="${H}" fill="url(#rm-sky-${id})" rx="10"/>`;
    svg += graticule();

    // rutas
    routes.forEach((r, i) => {
      const A = airports[r.from], B = airports[r.to];
      if (!A || !B) return;
      const pA = project(A.lat, A.lon), pB = project(B.lat, B.lon);
      const { d } = arcPath(pA, pB);
      const pid = `rm-path-${id}-${i}`;
      const strong = r.highlight !== false;
      svg += `<path id="${pid}" d="${d}" fill="none" stroke="${strong ? '#f2a104' : '#5d7fb8'}" stroke-width="${strong ? 2.4 : 1}" stroke-opacity="${strong ? 0.95 : 0.35}" ${strong ? 'stroke-dasharray="7 6"' : ''}/>`;
      if (animate && strong) {
        const dur = Math.max(4, Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) / 70);
        svg += `<g><g transform="rotate(90)"><g transform="translate(-13,-13) scale(1.08)">
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
      if (active) svg += `<circle cx="${x}" cy="${y}" r="16" fill="url(#rm-glow-${id})"/>`;
      svg += `<circle cx="${x}" cy="${y}" r="${active ? 4.6 : 3}" fill="${active ? '#ffcb66' : '#8fa8d6'}"/>`;
      svg += `<text x="${x + 8}" y="${y - 7}" fill="${active ? '#ffffff' : '#8fa8d6'}" font-family="JetBrains Mono, monospace" font-size="${active ? 13 : 10.5}" font-weight="${active ? 700 : 500}">${code}</text>`;
    });

    svg += '</svg>';
    el.innerHTML = svg;
  }

  return { render, project };
})();

window.RouteMap = RouteMap;
