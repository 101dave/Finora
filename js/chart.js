/**
 * The doughnut. Chart.js is vendored in /vendor so the page has no third-party
 * request at runtime; if it ever fails to load, the legend beside the chart
 * still carries every value.
 */
import { formatMoney } from './format.js';

let instance = null;

/* A greyscale ramp, dark to light: the only "colour" this app has. */
const PALETTE = [
  '#0d0d0d', '#333333', '#4d4d4d', '#666666', '#7d7d7d',
  '#929292', '#a6a6a6', '#bababa', '#cdcdcd', '#dedede',
];

export function paletteFor() {
  return PALETTE;
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
 */
export function renderDonut(canvas, series) {
  if (!canvas) return null;

  const Chart = window.Chart;
  if (!Chart || !series.length) {
    destroyDonut();
    canvas.hidden = true;
    return null;
  }
  canvas.hidden = false;

  const colors = paletteFor();
  const labels = series.map((point) => point.label);
  const values = series.map((point) => point.value);
  const background = labels.map((_, index) => colors[index % colors.length]);

  const styles = getComputedStyle(document.documentElement);
  const surface = styles.getPropertyValue('--surface').trim() || '#ffffff';
  const ink = styles.getPropertyValue('--ink').trim() || '#0d0d0d';

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
