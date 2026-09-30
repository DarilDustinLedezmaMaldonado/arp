'use strict';

/* global window, Chart */

const Charts = (() => {
  const live = new Map();

  function destroy(key) {
    if (live.has(key)) { live.get(key).destroy(); live.delete(key); }
  }

  function destroyAll() {
    live.forEach((c) => c.destroy());
    live.clear();
  }

  function base() {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#5b6b85';
  }

  function doughnut(key, canvas, labels, data, colors) {
    base();
    destroy(key);
    live.set(key, new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: { cutout: '64%', animation: { duration: 350 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } },
    }));
  }

  function bar(key, canvas, labels, datasets, opts = {}) {
    base();
    destroy(key);
    live.set(key, new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        indexAxis: opts.horizontal ? 'y' : 'x',
        animation: { duration: 350 },
        plugins: { legend: { display: datasets.length > 1, position: 'bottom' } },
        scales: { x: { stacked: !!opts.stacked, grid: { display: false } }, y: { stacked: !!opts.stacked, beginAtZero: true } },
      },
    }));
  }

  return { doughnut, bar, destroy, destroyAll };
})();

window.Charts = Charts;
