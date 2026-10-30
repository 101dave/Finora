/**
 * The doughnut. Chart.js is vendored in /vendor so the page has no third-party
 * request at runtime; if it ever fails to load, the legend beside the chart
 * still carries every value.
 */
import { formatMoney } from './format.js';

let instance = null;

const LIGHT_PALETTE = [
  '#a1542b', '#c1743f', '#7d5a33', '#b0855a', '#8d4a2a',
  '#c99a6a', '#6f4b2c', '#d1a77c', '#8a6a4a', '#9c6b45',
];

const DARK_PALETTE = [
  '#e8a06b', '#f0c096', '#c98a5f', '#f5d5b5', '#d97a45',
  '#e8c9a0', '#b57a52', '#f0dcc4', '#cfa07a', '#d8956a',
];

export function paletteFor(theme) {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

export function destroyDonut() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{label: string, value: number}[]} series
 * @param {'light'|'dark'} theme
 */
export function renderDonut(canvas, series, theme) {
  if (!canvas) return null;

  const Chart = window.Chart;
  if (!Chart || !series.length) {
    destroyDonut();
    canvas.hidden = true;
    return null;
  }
  canvas.hidden = false;

  const colors = paletteFor(theme);
  const labels = series.map((point) => point.label);
  const values = series.map((point) => point.value);
  const background = labels.map((_, index) => colors[index % colors.length]);

  const styles = getComputedStyle(document.documentElement);
  const surface = styles.getPropertyValue('--surface').trim() || '#ffffff';
  const ink = styles.getPropertyValue('--ink').trim() || '#221c16';

  const tooltip = {
    backgroundColor: ink,
    titleColor: surface,
    bodyColor: surface,
    padding: 10,
    cornerRadius: 8,
    displayColors: false,
    callbacks: {
      label: (context) => `${context.label}: ${formatMoney(context.parsed)}`,
    },
  };

  if (instance) {
    instance.data.labels = labels;
    instance.data.datasets[0].data = values;
    instance.data.datasets[0].backgroundColor = background;
    instance.data.datasets[0].borderColor = surface;
    instance.options.plugins.tooltip = { ...instance.options.plugins.tooltip, ...tooltip };
    instance.update();
    return instance;
  }

  instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: background,
        borderColor: surface,
        borderWidth: 2,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration: 320 },
      layout: { padding: 2 },
      plugins: {
        legend: { display: false },
        tooltip,
      },
    },
  });

  return instance;
}
