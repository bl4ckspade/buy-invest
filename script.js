// ---------- Fixzins-Funktionen ----------
function fv(pv, rate, years) {
  return pv * Math.pow(1 + rate, years);
}
function fvSeries(pmt, rate, years, freq) {
  const r = rate / freq;
  const n = years * freq;
  if (r === 0) return pmt * n;
  return pmt * (Math.pow(1 + r, n) - 1) / r;
}

// ---------- Historische Jahresrenditen (nominal, ungefähr 1999–2024, Total/Net gemischt als UI-Demo) ----------
const HISTORICAL_RETURNS = [
  0.2534, -0.1292, -0.1652, -0.1954, 0.3376, 0.1525, 0.1002, 0.2065, 0.0957, -0.4033,
  0.3079, 0.1234, -0.0502, 0.1654, 0.2737, 0.0550, -0.0032, 0.0815, 0.2307, -0.0820,
  0.2840, 0.1650, 0.2235, -0.1773, 0.2442, 0.1919
];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const amount = $('amount');
const isRecurring = $('isRecurring');
const frequency = $('frequency');
const years = $('years');
const yearsOut = $('yearsOut');
const ret = $('return');
const useInflation = $('useInflation');
const inflation = $('inflation');
const useTax = $('useTax');
const tax = $('tax');
const useHistorical = $('useHistorical');
const runsInput = $('runs');
const rerollBtn = $('reroll');
const runMCBtn = $('runMC');

const recurringGroup = $('recurringGroup');
const inflationGroup = $('inflationGroup');
const taxGroup = $('taxGroup');

const fvNominal = $('fvNominal');
const fvRealRow = $('fvRealRow');
const fvReal = $('fvReal');
const fvAfterTaxRow = $('fvAfterTaxRow');
const fvAfterTax = $('fvAfterTax');

const mcStats = $('mcStats');
const mcMedianEl = $('mcMedian');
const mcP10El = $('mcP10');
const mcP90El = $('mcP90');
const mcBestEl = $('mcBest');
const mcWorstEl = $('mcWorst');

const canvas = $('chart');
const ctx = canvas.getContext('2d');

// ---------- Utils ----------
const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
const fmtEUR = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function sampleReturns(years) {
  const out = [];
  for (let i = 0; i < years; i++) {
    const r = HISTORICAL_RETURNS[(Math.random() * HISTORICAL_RETURNS.length) | 0];
    out.push(r);
  }
  return out;
}
const monthlyRateFromAnnual = (r) => Math.pow(1 + r, 1/12) - 1;

function simulateSingleSeries(Y, recurring, F, A) {
  const randR = sampleReturns(Y);
  let value = 0;
  let paid = 0;
  const series = [];

  for (let y = 0; y <= Y; y++) {
    if (y > 0) {
      const rYear = randR[y - 1];
      value *= (1 + rYear);
      if (recurring) {
        if (F === 12) {
          const rm = monthlyRateFromAnnual(rYear);
          const contrib = rm === 0 ? A * 12 : A * (Math.pow(1 + rm, 12) - 1) / rm;
          value += contrib; paid += A * 12;
        } else {
          const rm = monthlyRateFromAnnual(rYear);
          const periods = (F === 52) ? 52 : 365;
          const rp = rm; // Näherung
          const contrib = rp === 0 ? A * periods : A * (Math.pow(1 + rp, periods) - 1) / rp;
          value += contrib; paid += A * periods;
        }
      } else if (y === 1) { value += A; paid += A; }
    }
    series.push({ year: y, nominal: value, principal: paid });
  }
  return series;
}

// Quantil-Helfer (p in [0,1])
function quantile(arr, p) {
  if (arr.length === 0) return 0;
  const a = arr.slice().sort((x,y)=>x-y);
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const w = idx - lo;
  return a[lo] * (1 - w) + a[hi] * w;
}

// Monte-Carlo über N Läufe: liefert Median-/P10-/P90-Pfad und Endwert-Stats
function runMonteCarlo(N, Y, recurring, F, A) {
  const yearBuckets = Array.from({length: Y+1}, () => []);
  const finalValues = [];

  for (let k = 0; k < N; k++) {
    const series = simulateSingleSeries(Y, recurring, F, A);
    for (let y = 0; y <= Y; y++) yearBuckets[y].push(series[y].nominal);
    finalValues.push(series[Y].nominal);
  }

  const p10 = [], med = [], p90 = [];
  for (let y = 0; y <= Y; y++) {
    const bucket = yearBuckets[y];
    p10.push({year:y, nominal: quantile(bucket, 0.10)});
    med.push({year:y, nominal: quantile(bucket, 0.50)});
    p90.push({year:y, nominal: quantile(bucket, 0.90)});
  }

  const stats = {
    median: quantile(finalValues, 0.50),
    p10: quantile(finalValues, 0.10),
    p90: quantile(finalValues, 0.90),
    best: Math.max(...finalValues),
    worst: Math.min(...finalValues)
  };

  return { p10, med, p90, stats };
}

// ---------- Hauptberechnung + UI ----------
function computeAndRender(singleOnly = true, mcPayload = null) {
  const A = Math.max(0, Number(amount.value || 0));
  const Y = clamp(Number(years.value || 0), 1, 100);
  const R = Math.max(0, Number(ret.value || 0)) / 100;
  const recurring = isRecurring.checked;
  const F = Number(frequency.value || 12);
  const infOn = useInflation.checked;
  const INF = Math.max(0, Number(inflation.value || 0)) / 100;
  const taxOn = useTax.checked;
  const TAX = Math.max(0, Number(tax.value || 0)) / 100;

  let nominal = 0, principal = 0, series = [];

  if (useHistorical.checked) {
    // Einzelpfad oder Medianpfad anzeigen
    if (singleOnly) {
      series = simulateSingleSeries(Y, recurring, F, A);
    } else if (mcPayload) {
      // Zeig Medianpfad im Chart, aber rechne Einzel-Outputs zusätzlich aus einem frischen Einzelpfad
      series = mcPayload.med;
    }
  } else {
    // Fixzinswelt
    if (!recurring) {
      nominal = fv(A, R, Y);
      principal = A;
      series = Array.from({length: Y+1}, (_,y)=>({year:y, nominal: y===0?0:fv(A, R, y), principal: y===0?0:A}));
    } else {
      nominal = fvSeries(A, R, Y, F);
      principal = A * Y * F;
      let value = 0, paid = 0;
      for (let y = 0; y <= Y; y++) {
        if (y > 0) {
          value *= (1 + R);
          const rPer = Math.pow(1 + R, 1/12) - 1;
          const contrib = rPer === 0 ? A * 12 : A * (Math.pow(1 + rPer, 12) - 1) / rPer;
          value += contrib; paid += A * 12;
        }
        series.push({year:y, nominal:value, principal:paid});
      }
    }
  }

  // Für historische Einzel-/Medianpfade Endwerte und principal bestimmen
  if (useHistorical.checked) {
    nominal = series[series.length - 1].nominal;
    // Principal: für Medianpfad nicht exakt definierbar, also aus Parametern
    principal = recurring ? A * Y * (F === 12 ? 12 : (F === 52 ? 52 : 365)) : A;
  }

  // Realwert und Nachsteuer (auf Basis des sichtbaren Pfads-Endwerts)
  let real = nominal;
  if (infOn) real = nominal / Math.pow(1 + INF, Y);
  let afterTax = nominal;
  if (taxOn) {
    const gains = Math.max(0, nominal - principal);
    afterTax = principal + gains * (1 - TAX);
  }

  // UI setzen
  fvNominal.textContent = fmtEUR.format(nominal);
  if (infOn) { fvRealRow.classList.remove('hidden'); fvReal.textContent = fmtEUR.format(real); }
  else fvRealRow.classList.add('hidden');
  if (taxOn) { fvAfterTaxRow.classList.remove('hidden'); fvAfterTax.textContent = fmtEUR.format(afterTax); }
  else fvAfterTaxRow.classList.add('hidden');

  // Chart
  if (mcPayload && !singleOnly) {
    drawChartWithBand(mcPayload.p10, mcPayload.med, mcPayload.p90);
    // MC-Stats anzeigen
    mcStats.classList.remove('hidden');
    mcMedianEl.textContent = fmtEUR.format(mcPayload.stats.median);
    mcP10El.textContent = fmtEUR.format(mcPayload.stats.p10);
    mcP90El.textContent = fmtEUR.format(mcPayload.stats.p90);
    mcBestEl.textContent = fmtEUR.format(mcPayload.stats.best);
    mcWorstEl.textContent = fmtEUR.format(mcPayload.stats.worst);
  } else {
    drawChart(series);
    mcStats.classList.add('hidden');
  }
}

// ---------- Charts ----------
function drawChart(data) {
  const w = canvas.width, h = canvas.height;
  const padL = 40, padR = 14, padT = 12, padB = 26;
  ctx.clearRect(0,0,w,h);
  if (!data.length) return;

  let maxY = 0;
  data.forEach(d => { maxY = Math.max(maxY, d.nominal || 0); });
  if (maxY <= 0) maxY = 1;

  const X = (i) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - v / maxY) * (h - padT - padB);

  // Grid
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = 'rgba(160,200,255,0.25)';
  ctx.lineWidth = 1;
  [0.33, 0.66, 1].forEach(fr => {
    const y = padT + fr * (h - padT - padB);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // Linie
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#63f5c6';
  ctx.beginPath();
  data.forEach((d,i) => { const x = X(i), y = Y(d.nominal); if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();
  ctx.shadowBlur = 14; ctx.shadowColor = 'rgba(99,245,198,0.45)'; ctx.stroke(); ctx.shadowBlur = 0;

  // Achsenlabels
  ctx.fillStyle = 'rgba(200,220,255,0.8)';
  ctx.font = '12px system-ui,-apple-system,Segoe UI,Roboto,Arial';
  const yearsTotal = data[data.length - 1].year;
  [0, Math.round(yearsTotal/2), yearsTotal].forEach(yval => {
    const i = data.findIndex(d => d.year === yval);
    if (i >= 0) { const x = X(i); ctx.fillText(`${yval} J.`, x - 12, h - 6); }
  });
}

function drawChartWithBand(p10, med, p90) {
  const w = canvas.width, h = canvas.height;
  const padL = 40, padR = 14, padT = 12, padB = 26;
  ctx.clearRect(0,0,w,h);

  const all = [...p10, ...p90, ...med];
  let maxY = 0;
  all.forEach(d => { maxY = Math.max(maxY, d.nominal || 0); });
  if (maxY <= 0) maxY = 1;

  const X = (i) => padL + (i / (med.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - v / maxY) * (h - padT - padB);

  // Grid
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = 'rgba(160,200,255,0.25)';
  ctx.lineWidth = 1;
  [0.33, 0.66, 1].forEach(fr => {
    const y = padT + fr * (h - padT - padB);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // Band füllen (P10–P90)
  ctx.beginPath();
  p10.forEach((d,i) => { const x = X(i), y = Y(d.nominal); if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  for (let i = p90.length - 1; i >= 0; i--) {
    const x = X(i), y = Y(p90[i].nominal);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(106,194,255,0.18)';
  ctx.fill();
  ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(106,194,255,0.35)'; ctx.fill(); ctx.shadowBlur = 0;

  // Median-Linie
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#6ac2ff';
  ctx.beginPath();
  med.forEach((d,i) => { const x = X(i), y = Y(d.nominal); if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();

  // Achsenlabels
  ctx.fillStyle = 'rgba(200,220,255,0.8)';
  ctx.font = '12px system-ui,-apple-system,Segoe UI,Roboto,Arial';
  const yearsTotal = med[med.length - 1].year;
  [0, Math.round(yearsTotal/2), yearsTotal].forEach(yval => {
    const i = med.findIndex(d => d.year === yval);
    if (i >= 0) { const x = X(i); ctx.fillText(`${yval} J.`, x - 12, h - 6); }
  });
}

// ---------- Bindings ----------
function bind() {
  const show = (elem, on) => elem.classList.toggle('hidden', !on);

  isRecurring.addEventListener('change', () => { show(recurringGroup, isRecurring.checked); computeAndRender(true); });
  useInflation.addEventListener('change', () => { show(inflationGroup, useInflation.checked); computeAndRender(true); });
  useTax.addEventListener('change', () => { show(taxGroup, useTax.checked); computeAndRender(true); });
  useHistorical.addEventListener('change', () => computeAndRender(true));

  years.addEventListener('input', () => { yearsOut.textContent = years.value; computeAndRender(true); });

  [amount, frequency, ret, inflation, tax, runsInput].forEach(elm => {
    elm.addEventListener('input', () => computeAndRender(true));
    elm.addEventListener('change', () => computeAndRender(true));
  });

  rerollBtn.addEventListener('click', () => computeAndRender(true));

  runMCBtn.addEventListener('click', () => {
    const A = Math.max(0, Number(amount.value || 0));
    const Y = clamp(Number(years.value || 0), 1, 100);
    const recurring = isRecurring.checked;
    const F = Number(frequency.value || 12);
    const N = clamp(Number(runsInput.value || 1000), 100, 5000);
    const mc = runMonteCarlo(N, Y, recurring, F, A);
    computeAndRender(false, mc);
  });

  // Initial
  computeAndRender(true);
}

document.addEventListener('DOMContentLoaded', bind);
