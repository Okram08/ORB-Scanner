// ============================================================
// TREND FOLLOWING — signal mensuel Or (MM50/MM200 + ADX)
// ============================================================

const WORKER_URL = 'https://red-bush-d58eorbscanner.tom-vandendorpe.workers.dev/';
const TICKER = 'GC=F'; // Or (futures COMEX, sert de proxy fiable au prix spot sur Yahoo)
const DEFAULT_MONTHLY_AMOUNT = 200;

const HISTORY_KEY = 'trend-following-history';
const AMOUNT_KEY = 'trend-following-monthly-amount';

const els = {
  signalContainer: document.getElementById('signal-container'),
  chartContainer: document.getElementById('chart-container'),
  allocationPanel: document.getElementById('allocation-panel'),
  historyContainer: document.getElementById('history-container'),
};

let chart = null;
let currentAnalysis = null;

init();

async function init() {
  try {
    const raw = await fetchDailyData(TICKER);
    const parsed = parseYahooResponse(raw);
    if (!parsed || parsed.closes.length < 210) {
      throw new Error('Pas assez de données historiques reçues (moins de 210 jours) — réessaie dans un instant.');
    }
    currentAnalysis = computeTrendSignal(parsed);
    renderSignal(currentAnalysis);
    renderChart(parsed, currentAnalysis);
    renderAllocationPanel(currentAnalysis);
    renderHistory();
  } catch (err) {
    els.signalContainer.innerHTML = `<div class="empty-hint" style="color:var(--bear);">Erreur : ${escapeHtml(err.message)}</div>`;
  }
}

// ------------------------------------------------------------
// FETCH — données journalières via le Worker Cloudflare
// ------------------------------------------------------------
async function fetchDailyData(ticker) {
  const url = `${WORKER_URL}?ticker=${encodeURIComponent(ticker)}&interval=1d&range=2y`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.chart?.error) throw new Error(data.chart.error.description || 'Erreur Yahoo');
  if (!data?.chart?.result?.[0]) throw new Error('Réponse vide — réessaie dans un instant');
  return data;
}

function parseYahooResponse(raw) {
  const result = raw.chart.result[0];
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  if (!timestamps || !quote) return null;

  const out = { timestamps: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue;
    out.timestamps.push(timestamps[i]);
    out.opens.push(quote.open[i]);
    out.highs.push(quote.high[i]);
    out.lows.push(quote.low[i]);
    out.closes.push(quote.close[i]);
    out.volumes.push(quote.volume[i] || 0);
  }
  return out;
}

// ------------------------------------------------------------
// CALCUL DU SIGNAL
// ------------------------------------------------------------
function computeTrendSignal(data) {
  const { closes, highs, lows } = data;
  const n = closes.length;

  const sma = (period) => {
    const out = new Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += closes[k];
      out[i] = sum / period;
    }
    return out;
  };

  const sma50 = sma(50);
  const sma200 = sma(200);

  const lastClose = closes[n - 1];
  const lastSma50 = sma50[n - 1];
  const lastSma200 = sma200[n - 1];
  const prevSma50 = sma50[n - 2];
  const prevSma200 = sma200[n - 2];

  const priceAboveSma200 = lastClose > lastSma200;
  const sma50AboveSma200 = lastSma50 > lastSma200;

  // Détecte un croisement récent (dans les 20 derniers jours de bourse, ~1 mois)
  let crossoverType = null;
  let daysSinceCrossover = null;
  for (let i = n - 1; i >= Math.max(1, n - 20); i--) {
    const wasAbove = sma50[i - 1] > sma200[i - 1];
    const isAbove = sma50[i] > sma200[i];
    if (wasAbove !== isAbove) {
      crossoverType = isAbove ? 'golden' : 'death';
      daysSinceCrossover = n - 1 - i;
      break;
    }
  }

  const adx = computeADX(highs, lows, closes, 14);

  // --- Détermination du signal ---
  let signal, verdict, reasons = [];

  if (priceAboveSma200 && sma50AboveSma200) {
    signal = 'invest';
    verdict = 'INVESTIR CE MOIS-CI';
    reasons.push({ icon: 'good', text: `Prix (${lastClose.toFixed(0)}) au-dessus de la MM200 (${lastSma200.toFixed(0)}) — tendance de fond haussière` });
    reasons.push({ icon: 'good', text: `MM50 (${lastSma50.toFixed(0)}) au-dessus de la MM200 — Golden Cross en vigueur` });
  } else if (!priceAboveSma200 && !sma50AboveSma200) {
    signal = 'hold';
    verdict = 'GARDER LE CASH CE MOIS-CI';
    reasons.push({ icon: 'bad', text: `Prix (${lastClose.toFixed(0)}) sous la MM200 (${lastSma200.toFixed(0)}) — tendance de fond baissière` });
    reasons.push({ icon: 'bad', text: `MM50 (${lastSma50.toFixed(0)}) sous la MM200 — Death Cross en vigueur` });
  } else {
    signal = 'caution';
    verdict = 'SIGNAL MIXTE — PRUDENCE';
    reasons.push({ icon: 'warn', text: `Signaux contradictoires : prix ${priceAboveSma200 ? 'au-dessus' : 'sous'} la MM200, mais MM50 ${sma50AboveSma200 ? 'au-dessus' : 'sous'} — phase de transition possible` });
  }

  if (crossoverType && daysSinceCrossover <= 20) {
    reasons.push({
      icon: crossoverType === 'golden' ? 'good' : 'bad',
      text: `${crossoverType === 'golden' ? 'Golden Cross' : 'Death Cross'} détecté il y a ${daysSinceCrossover} jour${daysSinceCrossover > 1 ? 's' : ''} de bourse — signal encore récent`,
    });
  }

  if (adx > 25) {
    reasons.push({ icon: 'good', text: `ADX ${adx.toFixed(0)} — tendance bien établie, contexte favorable au suivi de tendance` });
  } else if (adx > 15) {
    reasons.push({ icon: 'warn', text: `ADX ${adx.toFixed(0)} — tendance modérée, moins de conviction` });
  } else {
    reasons.push({ icon: 'warn', text: `ADX ${adx.toFixed(0)} — marché sans tendance claire (range), le signal MM est moins fiable dans ce contexte` });
  }

  return {
    lastClose, lastSma50, lastSma200, sma50Series: sma50, sma200Series: sma200,
    priceAboveSma200, sma50AboveSma200, crossoverType, daysSinceCrossover, adx,
    signal, verdict, reasons, timestamps: data.timestamps,
  };
}

function computeADX(highs, lows, closes, period) {
  const len = highs.length;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr, p) => {
    const out = [];
    let sum = arr.slice(0, p).reduce((s, v) => s + v, 0);
    out.push(sum);
    for (let i = p; i < arr.length; i++) { sum = sum - (sum / p) + arr[i]; out.push(sum); }
    return out;
  };
  const sTR = smooth(tr, period), sPlus = smooth(plusDM, period), sMinus = smooth(minusDM, period);
  const dx = [];
  for (let i = 0; i < sTR.length; i++) {
    const plusDI = 100 * (sPlus[i] / sTR[i]), minusDI = 100 * (sMinus[i] / sTR[i]);
    const sum = plusDI + minusDI;
    dx.push(sum > 0 ? 100 * Math.abs(plusDI - minusDI) / sum : 0);
  }
  const adxSlice = dx.slice(-period);
  return adxSlice.reduce((s, v) => s + v, 0) / adxSlice.length;
}

// ------------------------------------------------------------
// RENDU
// ------------------------------------------------------------
function renderSignal(a) {
  const stateClass = { invest: 'state-invest', hold: 'state-hold', caution: 'state-caution' }[a.signal];

  const reasonsHtml = a.reasons.map(r => `
    <div class="reasoning-row">
      <span class="reasoning-icon icon-${r.icon}">${r.icon === 'good' ? '✓' : r.icon === 'bad' ? '✗' : '~'}</span>
      <span>${escapeHtml(r.text)}</span>
    </div>
  `).join('');

  els.signalContainer.innerHTML = `
    <div class="signal-hero ${stateClass}">
      <div class="signal-hero-label">Signal du mois — Or (Gold)</div>
      <div class="signal-hero-verdict">${a.verdict}</div>
      <div class="signal-hero-detail">Basé sur le croisement MM50/MM200 et l'ADX — détail complet ci-dessous.</div>
    </div>

    <div class="grid-2">
      <div class="metric-card">
        <div class="metric-label">Prix actuel (clôture)</div>
        <div class="metric-value">${a.lastClose.toFixed(2)}</div>
        <div class="metric-sub ${a.priceAboveSma200 ? 'up' : 'down'}">${a.priceAboveSma200 ? 'Au-dessus' : 'Sous'} la MM200 (${a.lastSma200.toFixed(2)})</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">MM50 vs MM200</div>
        <div class="metric-value">${a.lastSma50.toFixed(2)} <span style="font-size:14px; color:var(--text-dim);">/ ${a.lastSma200.toFixed(2)}</span></div>
        <div class="metric-sub ${a.sma50AboveSma200 ? 'up' : 'down'}">${a.sma50AboveSma200 ? 'Golden Cross actif' : 'Death Cross actif'}</div>
      </div>
    </div>

    <div class="reasoning-panel">
      <div class="reasoning-title">Raisonnement complet</div>
      ${reasonsHtml}
    </div>
  `;
}

function renderChart(data, a) {
  els.chartContainer.innerHTML = '';

  if (typeof LightweightCharts === 'undefined') {
    els.chartContainer.innerHTML = '<div class="empty-hint">Graphique indisponible (librairie non chargée) — les données ci-dessus restent valides.</div>';
    return;
  }

  chart = LightweightCharts.createChart(els.chartContainer, {
    width: els.chartContainer.clientWidth,
    height: 356,
    layout: { background: { color: 'transparent' }, textColor: '#6B6D73', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#1A1B1F' }, horzLines: { color: '#1A1B1F' } },
    rightPriceScale: { borderColor: '#24262B' },
    timeScale: { borderColor: '#24262B', timeVisible: false },
  });

  const priceLine = chart.addLineSeries({ color: '#F0EEE8', lineWidth: 2, priceLineVisible: false });
  priceLine.setData(data.timestamps.map((t, i) => ({ time: t, value: data.closes[i] })).filter(d => d.value != null));

  const sma50Line = chart.addLineSeries({ color: '#D4A24C', lineWidth: 2, priceLineVisible: false });
  sma50Line.setData(data.timestamps.map((t, i) => ({ time: t, value: a.sma50Series[i] })).filter(d => d.value != null));

  const sma200Line = chart.addLineSeries({ color: '#C4554A', lineWidth: 2, priceLineVisible: false });
  sma200Line.setData(data.timestamps.map((t, i) => ({ time: t, value: a.sma200Series[i] })).filter(d => d.value != null));

  chart.timeScale().fitContent();

  new ResizeObserver(entries => {
    if (entries.length === 0 || !chart) return;
    chart.applyOptions({ width: entries[0].contentRect.width });
  }).observe(els.chartContainer);

  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.innerHTML = `
    <div class="legend-item"><span class="legend-swatch" style="background:#F0EEE8"></span>Prix</div>
    <div class="legend-item"><span class="legend-swatch" style="background:#D4A24C"></span>MM50</div>
    <div class="legend-item"><span class="legend-swatch" style="background:#C4554A"></span>MM200</div>
  `;
  els.chartContainer.parentElement.insertBefore(legend, els.chartContainer.nextSibling);
}

function renderAllocationPanel(a) {
  let amount = loadMonthlyAmount();

  const canInvest = a.signal === 'invest';

  els.allocationPanel.innerHTML = `
    <div class="allocation-row">
      <span class="allocation-label">Montant mensuel prévu</span>
      <span class="allocation-value">
        <input type="number" id="monthly-amount-input" value="${amount}" min="0" step="10"> €
      </span>
    </div>
    <div class="allocation-row">
      <span class="allocation-label">Décision ce mois-ci</span>
      <span class="allocation-value" style="color:${canInvest ? 'var(--bull)' : 'var(--text-dim)'}">${canInvest ? 'Investir' : 'Ne pas investir'}</span>
    </div>
    <button class="confirm-btn" id="confirm-decision-btn">${canInvest ? '✓ Confirmer l\'investissement de ce mois' : '✓ Confirmer : je garde le cash ce mois-ci'}</button>
  `;

  document.getElementById('monthly-amount-input').addEventListener('change', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) saveMonthlyAmount(val);
  });

  document.getElementById('confirm-decision-btn').addEventListener('click', () => {
    const currentAmount = parseFloat(document.getElementById('monthly-amount-input').value) || amount;
    recordDecision(a, currentAmount);
    renderHistory();
    const btn = document.getElementById('confirm-decision-btn');
    btn.textContent = '✓ Décision enregistrée dans l\'historique';
    btn.disabled = true;
  });
}

function loadMonthlyAmount() {
  try {
    const raw = localStorage.getItem(AMOUNT_KEY);
    return raw ? parseFloat(raw) : DEFAULT_MONTHLY_AMOUNT;
  } catch { return DEFAULT_MONTHLY_AMOUNT; }
}

function saveMonthlyAmount(value) {
  try { localStorage.setItem(AMOUNT_KEY, String(value)); } catch { /* ignore */ }
}

// ------------------------------------------------------------
// HISTORIQUE DES DÉCISIONS
// ------------------------------------------------------------
function loadDecisionHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDecisionHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* ignore */ }
}

function recordDecision(analysis, amount) {
  const history = loadDecisionHistory();
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Dédoublonnage : une seule décision enregistrée par mois calendaire
  const filtered = history.filter(h => h.monthKey !== monthKey);

  filtered.unshift({
    monthKey,
    date: new Date().toISOString().slice(0, 10),
    signal: analysis.signal,
    verdict: analysis.verdict,
    amount: analysis.signal === 'invest' ? amount : 0,
    priceAtDecision: analysis.lastClose,
    adx: analysis.adx,
  });

  saveDecisionHistory(filtered);
}

function renderHistory() {
  const history = loadDecisionHistory();

  if (history.length === 0) {
    els.historyContainer.innerHTML = '<div class="empty-hint">Aucune décision enregistrée pour l\'instant.</div>';
    return;
  }

  const totalInvested = history.reduce((s, h) => s + h.amount, 0);
  const monthsInvested = history.filter(h => h.amount > 0).length;

  const rows = history.map(h => `
    <tr>
      <td style="color:var(--text-dim); font-family:var(--sans); font-size:11px;">${h.date}</td>
      <td style="color:${h.signal === 'invest' ? 'var(--bull)' : h.signal === 'hold' ? 'var(--text-dim)' : 'var(--warn)'};">${h.verdict}</td>
      <td>${h.priceAtDecision.toFixed(2)}</td>
      <td>ADX ${h.adx.toFixed(0)}</td>
      <td style="font-weight:700; color:var(--text-bright);">${h.amount > 0 ? h.amount.toLocaleString('fr-BE') + ' €' : '—'}</td>
    </tr>
  `).join('');

  els.historyContainer.innerHTML = `
    <div style="font-family:var(--mono); font-size:12px; color:var(--text-dim); margin-bottom:12px;">
      Total investi : <strong style="color:var(--text-bright);">${totalInvested.toLocaleString('fr-BE')} €</strong> sur ${monthsInvested} mois actifs (${history.length} décision${history.length > 1 ? 's' : ''} au total)
    </div>
    <table class="history-table">
      <thead><tr><th>Date</th><th>Décision</th><th>Prix Or ($/oz)</th><th>ADX</th><th>Montant</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
