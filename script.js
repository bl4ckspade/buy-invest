// ---------- Fixzins-Funktionen ----------
function fv(pv, rate, years) { return pv * Math.pow(1 + rate, years); }
function fvSeries(pmt, rate, years, freq) {
  const r = rate / freq, n = years * freq;
  if (r === 0) return pmt * n;
  return pmt * (Math.pow(1 + r, n) - 1) / r;
}

// ---------- Historische Jahresrenditen (Demo-Liste 1999–2024) ----------
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
const hoverTip = $('hoverTip');

// ---------- Utils ----------
const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
const fmtEUR = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const monthlyRateFromAnnual = (r) => Math.pow(1 + r, 1/12) - 1;

function sampleReturns(Y) {
  const out=[]; for(let i=0;i<Y;i++) out.push(HISTORICAL_RETURNS[(Math.random()*HISTORICAL_RETURNS.length)|0]);
  return out;
}

// Simulation einer Serie (Einzelpfad)
function simulateSingleSeries(Y, recurring, F, A) {
  const randR = sampleReturns(Y);
  let value = 0, paid = 0;
  const series = [];
  for (let y = 0; y <= Y; y++) {
    if (y > 0) {
      const rYear = randR[y-1];
      value *= (1 + rYear);
      if (recurring) {
        if (F === 12) {
          const rm = monthlyRateFromAnnual(rYear);
          const contrib = rm === 0 ? A*12 : A * (Math.pow(1+rm,12)-1)/rm;
          value += contrib; paid += A*12;
        } else {
          const rm = monthlyRateFromAnnual(rYear);
          const periods = (F===52)?52:365, rp = rm; // Annäherung
          const contrib = rp === 0 ? A*periods : A * (Math.pow(1+rp,periods)-1)/rp;
          value += contrib; paid += A*periods;
        }
      } else if (y===1) { value += A; paid += A; }
    }
    series.push({year:y, nominal:value, principal:paid});
  }
  return series;
}

// Quantil
function quantile(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x,y)=>x-y);
  const idx = (a.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const w = idx - lo; return a[lo]*(1-w) + a[hi]*w;
}

// Monte-Carlo über N Läufe
function runMonteCarlo(N, Y, recurring, F, A) {
  const buckets = Array.from({length:Y+1},()=>[]);
  const finals = [];
  for (let k=0;k<N;k++){
    const s = simulateSingleSeries(Y,recurring,F,A);
    for (let y=0;y<=Y;y++) buckets[y].push(s[y].nominal);
    finals.push(s[Y].nominal);
  }
  const p10=[], med=[], p90=[];
  for (let y=0;y<=Y;y++){
    const b = buckets[y];
    p10.push({year:y, nominal: quantile(b,0.10)});
    med.push({year:y, nominal: quantile(b,0.50)});
    p90.push({year:y, nominal: quantile(b,0.90)});
  }
  return {
    p10, med, p90,
    stats: {
      median: quantile(finals,0.50),
      p10: quantile(finals,0.10),
      p90: quantile(finals,0.90),
      best: Math.max(...finals),
      worst: Math.min(...finals)
    }
  };
}

// ---------- State für Chart/Interaktion ----------
let hoverIndex = null;
let lastSeriesForHover = [];
let currentChartPayload = null;

// Rechen- und Render-Pipeline
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
    if (singleOnly) {
      series = simulateSingleSeries(Y, recurring, F, A);
    } else if (mcPayload) {
      series = mcPayload.med; // Medianpfad anzeigen
    }
  } else {
    if (!recurring) {
      nominal = fv(A, R, Y); principal = A;
      series = Array.from({length:Y+1}, (_,y)=>({year:y, nominal: y===0?0:fv(A,R,y), principal: y===0?0:A}));
    } else {
      nominal = fvSeries(A, R, Y, F); principal = A * Y * F;
      let value=0, paid=0;
      for (let y=0;y<=Y;y++){
        if (y>0){
          value *= (1+R);
          const rPer = Math.pow(1+R,1/12)-1;
          const contrib = rPer===0 ? A*12 : A*(Math.pow(1+rPer,12)-1)/rPer;
          value += contrib; paid += A*12;
        }
        series.push({year:y, nominal:value, principal:paid});
      }
    }
  }

  if (useHistorical.checked) {
    nominal = series[series.length-1].nominal;
    principal = recurring ? A * Y * (F===12?12:(F===52?52:365)) : A;
  }

  let real = nominal; if (infOn) real = nominal / Math.pow(1 + INF, Y);
  let afterTax = nominal;
  if (taxOn) { const gains = Math.max(0, nominal - principal); afterTax = principal + gains * (1 - TAX); }

  fvNominal.textContent = fmtEUR.format(nominal);
  if (infOn){ fvRealRow.classList.remove('hidden'); fvReal.textContent = fmtEUR.format(real); } else fvRealRow.classList.add('hidden');
  if (taxOn){ fvAfterTaxRow.classList.remove('hidden'); fvAfterTax.textContent = fmtEUR.format(afterTax); } else fvAfterTaxRow.classList.add('hidden');

  // Chart vorbereiten
  lastSeriesForHover = (mcPayload && !singleOnly) ? mcPayload.med : series;
  currentChartPayload = mcPayload && !singleOnly ? {type:'band', data: mcPayload} : {type:'single', data: series};
  drawCurrentChart();

  // MC-Stats
  if (mcPayload && !singleOnly) {
    mcStats.classList.remove('hidden');
    mcMedianEl.textContent = fmtEUR.format(mcPayload.stats.median);
    mcP10El.textContent = fmtEUR.format(mcPayload.stats.p10);
    mcP90El.textContent = fmtEUR.format(mcPayload.stats.p90);
    mcBestEl.textContent = fmtEUR.format(mcPayload.stats.best);
    mcWorstEl.textContent = fmtEUR.format(mcPayload.stats.worst);
  } else {
    mcStats.classList.add('hidden');
  }
}

function drawCurrentChart(){
  if (!currentChartPayload) return;
  if (currentChartPayload.type === 'band') {
    const {p10, med, p90} = currentChartPayload.data;
    drawChartWithBand(p10, med, p90, true);
  } else {
    drawChart(currentChartPayload.data, true);
  }
}

// ---------- Chart-Funktionen ----------
function drawGridAndAxes(maxY, len){
  const w = canvas.width, h = canvas.height;
  const padL = 40, padR = 14, padT = 12, padB = 32;

  // Grid
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = 'rgba(160,200,255,0.25)';
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(fr => {
    const y = padT + fr * (h - padT - padB);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // X-Labels
  ctx.fillStyle = 'rgba(200,220,255,0.85)';
  ctx.font = '14px system-ui,-apple-system,Segoe UI,Roboto,Arial';
  const yearsTotal = len - 1;
  [0, Math.round(yearsTotal/2), yearsTotal].forEach(yval => {
    const x = padL + (yval / yearsTotal) * (w - padL - padR);
    ctx.fillText(`${yval} J.`, x - 12, h - 8);
  });

  return {padL, padR, padT, padB};
}

function drawChart(data, useHover=false){
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  if (!data.length) return;

  let maxY=0; data.forEach(d => { maxY = Math.max(maxY, d.nominal||0); });
  if (maxY<=0) maxY=1;

  const {padL, padR, padT, padB} = drawGridAndAxes(maxY, data.length);
  const X = (i) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - v / maxY) * (h - padT - padB);

  // Linie
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = '#63f5c6';
  ctx.beginPath();
  data.forEach((d,i)=>{ const x=X(i), y=Y(d.nominal); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();
  ctx.shadowBlur = 14; ctx.shadowColor = 'rgba(99,245,198,0.45)'; ctx.stroke(); ctx.shadowBlur = 0;

  // Hover
  if (useHover && hoverIndex!=null){
    const x = X(hoverIndex), y = Y(data[hoverIndex].nominal);
    ctx.save();
    ctx.strokeStyle = 'rgba(106,194,255,0.6)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    ctx.fillStyle = '#63f5c6'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    showHoverTip(data[hoverIndex].year, {x,y}, data[hoverIndex].nominal);
  } else { hideHoverTip(); }
}

function drawChartWithBand(p10, med, p90, useHover=false){
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const all = [...p10,...p90,...med];
  let maxY=0; all.forEach(d=>{ maxY=Math.max(maxY,d.nominal||0); });
  if (maxY<=0) maxY=1;

  const {padL, padR, padT, padB} = drawGridAndAxes(maxY, med.length);
  const X = (i) => padL + (i / (med.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - v / maxY) * (h - padT - padB);

  // Band füllen
  ctx.beginPath();
  p10.forEach((d,i)=>{ const x=X(i), y=Y(d.nominal); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  for (let i=p90.length-1;i>=0;i--){ const x=X(i), y=Y(p90[i].nominal); ctx.lineTo(x,y); }
  ctx.closePath();
  ctx.fillStyle = 'rgba(106,194,255,0.18)'; ctx.fill();
  ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(106,194,255,0.35)'; ctx.fill(); ctx.shadowBlur = 0;

  // Median
  ctx.lineWidth = 2.6; ctx.strokeStyle = '#6ac2ff';
  ctx.beginPath();
  med.forEach((d,i)=>{ const x=X(i), y=Y(d.nominal); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();

  // Hover
  if (useHover && hoverIndex!=null){
    const x = X(hoverIndex), y = Y(med[hoverIndex].nominal);
    ctx.save();
    ctx.strokeStyle = 'rgba(106,194,255,0.6)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    ctx.fillStyle = '#63f5c6'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    showHoverTip(med[hoverIndex].year, {x,y}, med[hoverIndex].nominal);
  } else { hideHoverTip(); }
}

// ---------- Hover/Touch ----------
function indexFromClientX(evt, length) {
  const rect = canvas.getBoundingClientRect();
  const cx = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
  const wCss = rect.width, scaleX = canvas.width / wCss;
  const x = cx * scaleX;

  const padL = 40, padR = 14;
  const innerW = canvas.width - padL - padR;
  const clamped = Math.max(padL, Math.min(canvas.width - padR, x));
  const t = (clamped - padL) / innerW;
  const i = Math.round(t * (length - 1));
  return Math.max(0, Math.min(length - 1, i));
}

function showHoverTip(year, point, nominalValue) {
  hoverTip.classList.remove('hidden');
  hoverTip.innerHTML = `Jahr ${year} · ${fmtEUR.format(nominalValue)}`;

  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const px = rect.left + point.x * scaleX;
  const py = rect.top + point.y * scaleY;

  hoverTip.style.left = px + 'px';
  hoverTip.style.top  = (py - 8) + 'px';
}

function hideHoverTip(){ hoverTip.classList.add('hidden'); }

// ---------- Bindings ----------
function bind() {
  const show = (el, on) => el.classList.toggle('hidden', !on);

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

  // Hover/Touch Events
  function handleMove(e){
    if (!lastSeriesForHover.length) return;
    hoverIndex = indexFromClientX(e, lastSeriesForHover.length);
    drawCurrentChart();
  }
  canvas.addEventListener('mousemove', handleMove);
  canvas.addEventListener('mouseleave', () => { hoverIndex=null; hideHoverTip(); drawCurrentChart(); });
  canvas.addEventListener('touchstart', handleMove, {passive:true});
  canvas.addEventListener('touchmove', handleMove, {passive:true});
  canvas.addEventListener('touchend', () => { hoverIndex=null; hideHoverTip(); drawCurrentChart(); });

  // Initial
  computeAndRender(true);
}

document.addEventListener('DOMContentLoaded', bind);
