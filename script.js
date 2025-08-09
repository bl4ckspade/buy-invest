// ---------- Math helpers (as requested) ----------
function fv(pv, rate, years) {
  return pv * Math.pow(1 + rate, years);
}
function fvSeries(pmt, rate, years, freq) {
  const r = rate / freq;
  const n = years * freq;
  if (r === 0) return pmt * n;
  return pmt * (Math.pow(1 + r, n) - 1) / r;
}

// ---------- DOM ----------
const el = (id) => document.getElementById(id);

const amount = el('amount');
const isRecurring = el('isRecurring');
const frequency = el('frequency');
const years = el('years');
const yearsOut = el('yearsOut');
const ret = el('return');

const useInflation = el('useInflation');
const inflation = el('inflation');

const useTax = el('useTax');
const tax = el('tax');

const recurringGroup = el('recurringGroup');
const inflationGroup = el('inflationGroup');
const taxGroup = el('taxGroup');

const fvNominal = el('fvNominal');
const fvRealRow = el('fvRealRow');
const fvReal = el('fvReal');
const fvAfterTaxRow = el('fvAfterTaxRow');
const fvAfterTax = el('fvAfterTax');

const chartCanvas = el('chart');
const ctx = chartCanvas.getContext('2d', { willReadFrequently: false });

// ---------- Formatting ----------
const fmt = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));

// ---------- State + compute ----------
function compute() {
  const A = Math.max(0, Number(amount.value || 0));
  const Y = clamp(Number(years.value || 0), 0, 100);
  const R = Math.max(0, Number(ret.value || 0)) / 100;

  const infOn = useInflation.checked;
  const INF = Math.max(0, Number(inflation.value || 0)) / 100;

  const taxOn = useTax.checked;
  const TAX = Math.max(0, Number(tax.value || 0)) / 100;

  const recurring = isRecurring.checked;
  const F = Number(frequency.value || 12);

  // Total nominal future value
  let nominal = 0;
  let principal = 0;

  if (!recurring) {
    nominal = fv(A, R, Y);
    principal = A;
  } else {
    nominal = fvSeries(A, R, Y, F);
    principal = A * Y * F;
  }

  // Real value: deflate by inflation
  let real = nominal;
  if (infOn) {
    real = nominal / Math.pow(1 + INF, Y);
  }

  // After-tax: tax only on gains at the end
  // gains = nominal - principal
  let afterTax = nominal;
  if (taxOn) {
    const gains = Math.max(0, nominal - principal);
    afterTax = principal + gains * (1 - TAX);
  }

  // Update UI
  fvNominal.textContent = fmt.format(nominal);

  if (infOn) {
    fvRealRow.classList.remove('hidden');
    fvReal.textContent = fmt.format(real);
  } else {
    fvRealRow.classList.add('hidden');
  }

  if (taxOn) {
    fvAfterTaxRow.classList.remove('hidden');
    fvAfterTax.textContent = fmt.format(afterTax);
  } else {
    fvAfterTaxRow.classList.add('hidden');
  }

  drawChart(series(Y, R, A, recurring, F, infOn ? INF : null, taxOn ? TAX : null), nominal);
}

function series(Y, R, A, recurring, F, INF /* or null */, TAX /* or null */) {
  // Return an array of yearly snapshots: {year, nominal, real?, afterTax?}
  const out = [];
  let nominal = 0;
  let principal = 0;

  for (let y = 0; y <= Y; y++) {
    if (recurring) {
      nominal = fvSeries(A, R, y, F);
      principal = A * y * F;
    } else {
      nominal = fv(A, R, y);
      principal = y === 0 ? 0 : A; // after year 0 we've "contributed" once
    }

    const item = { year: y, nominal };

    if (INF !== null) {
      item.real = nominal / Math.pow(1 + INF, y);
    }
    if (TAX !== null) {
      const gains = Math.max(0, nominal - principal);
      item.afterTax = principal + gains * (1 - TAX);
    }
    out.push(item);
  }
  return out;
}

// ---------- Chart (minimal, no libs) ----------
function drawChart(data, nominalFinal) {
  const w = chartCanvas.width, h = chartCanvas.height;
  ctx.clearRect(0,0,w,h);

  // Axes padding
  const padL = 40, padR = 14, padT = 12, padB = 26;

  // Determine max across visible series
  let maxY = 0;
  data.forEach(d => {
    maxY = Math.max(maxY, d.nominal, d.real ?? 0, d.afterTax ?? 0);
  });
  if (maxY <= 0) return;

  // Simple helpers
  const X = (i) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - v / maxY) * (h - padT - padB);

  // Grid lines (3)
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = 'rgba(160,200,255,0.25)';
  ctx.lineWidth = 1;
  [0.33, 0.66, 1].forEach(fr => {
    const y = padT + fr * (h - padT - padB);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // Draw a polyline helper
  const line = (key, glow) => {
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = X(i), y = Y(d[key]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (glow) {
      ctx.shadowBlur = 14;
      ctx.shadowColor = glow;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };

  // Styles: nominal = mint, real = blue, afterTax = desaturated mint/blue
  ctx.lineWidth = 2.2;

  // nominal
  ctx.strokeStyle = '#63f5c6';
  line('nominal', 'rgba(99,245,198,0.45)');

  // real (if any)
  if ('real' in data[0]) {
    ctx.strokeStyle = '#6ac2ff';
    line('real', 'rgba(106,194,255,0.45)');
  }

  // afterTax (if any)
  if ('afterTax' in data[0]) {
    ctx.strokeStyle = 'rgba(99,245,198,0.6)';
    line('afterTax', 'rgba(99,245,198,0.35)');
  }

  // X axis labels: start, mid, end
  ctx.fillStyle = 'rgba(200,220,255,0.8)';
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  const yearsTotal = data[data.length - 1].year;
  const labels = [0, Math.round(yearsTotal/2), yearsTotal];
  labels.forEach((yval, idx) => {
    const i = data.findIndex(d => d.year === yval);
    if (i >= 0) {
      const x = X(i);
      ctx.fillText(`${yval} J.`, x - 12, h - 6);
    }
  });
}

// ---------- UI interactions ----------
function bind() {
  // Show/hide groups
  const show = (elem, on) => elem.classList.toggle('hidden', !on);

  isRecurring.addEventListener('change', () => { show(recurringGroup, isRecurring.checked); compute(); });
  useInflation.addEventListener('change', () => { show(inflationGroup, useInflation.checked); compute(); });
  useTax.addEventListener('change', () => { show(taxGroup, useTax.checked); compute(); });

  years.addEventListener('input', () => { yearsOut.textContent = years.value; compute(); });

  [amount, frequency, ret, inflation, tax].forEach(elm => {
    elm.addEventListener('input', compute);
    elm.addEventListener('change', compute);
  });

  compute();
}

document.addEventListener('DOMContentLoaded', bind);
