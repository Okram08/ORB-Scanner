// ============================================================
// BEHAVIORAL EXTREMES — Reversion + Momentum Exhaustion
// Détecte des sur-réactions de foule via proxys quantitatifs
// (prix/volume/volatilité) — pas de vraie analyse de sentiment social.
// ============================================================

const WORKER_URL = 'https://red-bush-d58eorbscanner.tom-vandendorpe.workers.dev/';
const UNIVERSE = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD'];

const els = {
  scanBtn: document.getElementById('scan-btn'),
  resultsContainer: document.getElementById('results-container'),
};

els.scanBtn.addEventListener('click', runScan);

let lastResults = [];

// ------------------------------------------------------------
// ORCHESTRATION
// ------------------------------------------------------------
async function runScan() {
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = 'Scan en cours...';
  els.resultsContainer.innerHTML = `<div class="empty-state"><div class="glyph">◈</div><p>Récupération et analyse en cours...</p></div>`;

  const results = [];
  const errors = [];

  for (const ticker of UNIVERSE) {
    try {
      const raw = await fetchHourlyData(ticker);
      const parsed = parseYahooResponse(raw);
      if (!parsed || parsed.closes.length < 100) {
        errors.push(`${ticker}: données insuffisantes`);
        continue;
      }
      const analysis = analyzeAsset(ticker, parsed);
      results.push(analysis);
    } catch (e) {
      errors.push(`${ticker}: ${e.message}`);
    }
  }

  lastResults = results;
  els.scanBtn.disabled = false;
  els.scanBtn.textContent = "Scanner l'univers crypto";

  renderGrid(results, errors);
}

// ------------------------------------------------------------
// FETCH — données horaires via le Worker Cloudflare
// ------------------------------------------------------------
async function fetchHourlyData(ticker) {
  const url = `${WORKER_URL}?ticker=${encodeURIComponent(ticker)}&interval=60m&range=60d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.chart?.error) throw new Error(data.chart.error.description || 'Erreur Yahoo');
  if (!data?.chart?.result?.[0]) throw new Error('Réponse vide');
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
// MODULE A — Market Scanner : métriques de base multi-horizons
// ------------------------------------------------------------
function computeReturns(closes, hoursBack) {
  const n = closes.length;
  if (n <= hoursBack) return 0;
  return (closes[n - 1] - closes[n - 1 - hoursBack]) / closes[n - 1 - hoursBack];
}

function computeVolatilityZScore(closes, window = 168) { // 168h = 7 jours
  const n = closes.length;
  const returns = [];
  for (let i = 1; i < n; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);

  const recentWindow = Math.min(window, returns.length);
  const recent = returns.slice(-recentWindow);
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
  const stdDev = Math.sqrt(variance);

  // Volatilité très récente (24h) vs volatilité de référence (7j)
  const veryRecent = returns.slice(-24);
  const recentMean = veryRecent.reduce((s, v) => s + v, 0) / veryRecent.length;
  const recentVariance = veryRecent.reduce((s, v) => s + (v - recentMean) ** 2, 0) / veryRecent.length;
  const recentStdDev = Math.sqrt(recentVariance);

  return stdDev > 0 ? (recentStdDev - stdDev) / stdDev : 0;
}

function computeVolumeRatio(volumes, recentHours = 24) {
  const n = volumes.length;
  const recent = volumes.slice(-recentHours);
  const historical = volumes.slice(-24 * 14, -recentHours); // 14 jours de référence hors période récente
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const historicalAvg = historical.length > 0 ? historical.reduce((s, v) => s + v, 0) / historical.length : recentAvg;
  return historicalAvg > 0 ? recentAvg / historicalAvg : 1;
}

// Extension de prix par rapport à une moyenne mobile de référence (proxy de sur-réaction)
function computePriceExtension(closes, period = 50) {
  const n = closes.length;
  const window = closes.slice(-period);
  const sma = window.reduce((s, v) => s + v, 0) / window.length;
  return (closes[n - 1] - sma) / sma;
}

// Accélération du mouvement : la variation de la variation (dérivée seconde)
function computeAcceleration(closes, shortWindow = 6) {
  const n = closes.length;
  if (n < shortWindow * 2) return 0;
  const ret1 = (closes[n - 1] - closes[n - 1 - shortWindow]) / closes[n - 1 - shortWindow];
  const ret2 = (closes[n - 1 - shortWindow] - closes[n - 1 - shortWindow * 2]) / closes[n - 1 - shortWindow * 2];
  return ret1 - ret2;
}

// ------------------------------------------------------------
// MODULE C — Extremes Detector : essoufflement du momentum
// ------------------------------------------------------------
// Cherche si le mouvement récent (après un excès) commence à ralentir —
// condition centrale du document pour autoriser une entrée contrarian.
function computeMomentumDecay(closes, lookback = 12) {
  const n = closes.length;
  if (n < lookback * 2) return { decaying: false, ratio: 1 };

  const veryRecentMove = Math.abs(closes[n - 1] - closes[n - 1 - lookback]);
  const priorMove = Math.abs(closes[n - 1 - lookback] - closes[n - 1 - lookback * 2]);

  const ratio = priorMove > 0 ? veryRecentMove / priorMove : 1;
  // decaying = true si le mouvement récent est nettement plus faible que le mouvement précédent
  return { decaying: ratio < 0.5, ratio };
}

// Détecte un "rejet" : la dernière bougie a une mèche significative dans le sens opposé
// au mouvement dominant récent — proxy du "premier refus" mentionné dans le document.
function detectRejectionCandle(opens, highs, lows, closes, isOverextendedUp) {
  const n = closes.length;
  const lastOpen = opens[n - 1], lastHigh = highs[n - 1], lastLow = lows[n - 1], lastClose = closes[n - 1];
  const bodySize = Math.abs(lastClose - lastOpen);
  const totalRange = lastHigh - lastLow;
  if (totalRange <= 0) return false;

  if (isOverextendedUp) {
    // Cherche une mèche haute longue (rejet des plus hauts) — signe de refus de continuer à monter
    const upperWick = lastHigh - Math.max(lastOpen, lastClose);
    return upperWick / totalRange > 0.4;
  } else {
    // Cherche une mèche basse longue (rejet des plus bas) — signe de refus de continuer à baisser
    const lowerWick = Math.min(lastOpen, lastClose) - lastLow;
    return lowerWick / totalRange > 0.4;
  }
}

// ------------------------------------------------------------
// MODULE D — Entry Engine : score d'opportunité 0-100
// ------------------------------------------------------------
function analyzeAsset(ticker, data) {
  const { closes, highs, lows, opens, volumes } = data;
  const lastClose = closes[closes.length - 1];

  const ret1h = computeReturns(closes, 1);
  const ret4h = computeReturns(closes, 4);
  const ret1d = computeReturns(closes, 24);

  const volZScore = computeVolatilityZScore(closes);
  const volumeRatio = computeVolumeRatio(volumes);
  const priceExtension = computePriceExtension(closes, 50);
  const acceleration = computeAcceleration(closes);
  const momentumDecay = computeMomentumDecay(closes);

  const isOverextendedUp = priceExtension > 0.08; // 8% au-dessus de la MM50 (seuil ajustable)
  const isOverextendedDown = priceExtension < -0.08;
  const hasRejection = (isOverextendedUp || isOverextendedDown) && detectRejectionCandle(opens, highs, lows, closes, isOverextendedUp);

  // --- Score d'opportunité 0-100 ---
  let score = 0;
  const details = [];

  // Extension de prix (30 pts max) — le cœur du signal "sur-réaction"
  const absExtension = Math.abs(priceExtension);
  if (absExtension > 0.15) {
    score += 30; details.push({ icon: 'good', text: `Extension de prix extrême : ${(priceExtension * 100).toFixed(1)}% vs MM50 — sur-réaction marquée` });
  } else if (absExtension > 0.08) {
    score += 18; details.push({ icon: 'warn', text: `Extension de prix notable : ${(priceExtension * 100).toFixed(1)}% vs MM50` });
  } else {
    details.push({ icon: 'neutral', text: `Extension de prix faible : ${(priceExtension * 100).toFixed(1)}% vs MM50 — pas d'excès` });
  }

  // Volume anormal (20 pts max) — proxy de pression de foule
  if (volumeRatio > 2.5) {
    score += 20; details.push({ icon: 'good', text: `Volume ${volumeRatio.toFixed(1)}× la normale — forte participation, signe de mouvement de foule` });
  } else if (volumeRatio > 1.5) {
    score += 10; details.push({ icon: 'warn', text: `Volume ${volumeRatio.toFixed(1)}× la normale — participation modérée` });
  } else {
    details.push({ icon: 'neutral', text: `Volume ${volumeRatio.toFixed(1)}× la normale — rien d'anormal` });
  }

  // Z-score de volatilité (15 pts max)
  if (volZScore > 1) {
    score += 15; details.push({ icon: 'good', text: `Volatilité récente nettement supérieure à la normale (z≈${volZScore.toFixed(1)}) — climat émotionnel` });
  } else if (volZScore > 0.3) {
    score += 8; details.push({ icon: 'warn', text: `Volatilité en hausse modérée (z≈${volZScore.toFixed(1)})` });
  } else {
    details.push({ icon: 'neutral', text: `Volatilité proche de la normale (z≈${volZScore.toFixed(1)})` });
  }

  // Momentum decay — condition la plus importante du document (25 pts max)
  if (momentumDecay.decaying && (isOverextendedUp || isOverextendedDown)) {
    score += 25; details.push({ icon: 'good', text: `Essoufflement confirmé — le mouvement récent (ratio ${momentumDecay.ratio.toFixed(2)}) ralentit nettement vs la phase précédente` });
  } else if (isOverextendedUp || isOverextendedDown) {
    details.push({ icon: 'bad', text: `Mouvement encore en accélération (ratio ${momentumDecay.ratio.toFixed(2)}) — pas d'essoufflement, entrée prématurée` });
  } else {
    details.push({ icon: 'neutral', text: `Pas d'extension significative pour évaluer l'essoufflement` });
  }

  // Bougie de rejet (10 pts max) — confirmation de structure
  if (hasRejection) {
    score += 10; details.push({ icon: 'good', text: `Bougie de rejet détectée — premier refus de continuation dans le sens de l'excès` });
  } else if (isOverextendedUp || isOverextendedDown) {
    details.push({ icon: 'neutral', text: `Pas encore de bougie de rejet claire` });
  }

  // --- Filtres anti-piège (document section 6) ---
  const stillAccelerating = Math.abs(acceleration) > Math.abs(ret4h) * 0.5 && !momentumDecay.decaying;
  if (stillAccelerating) {
    details.push({ icon: 'bad', text: `⚠ Filtre : le mouvement est encore en accélération nette — risque de confondre excès et vraie tendance forte` });
  }

  // --- Direction et validité du setup ---
  let direction = null;
  let setupValid = false;

  if (isOverextendedUp && momentumDecay.decaying && !stillAccelerating) {
    direction = 'short'; // euphorie qui s'essouffle -> contrarian short
    setupValid = score >= 55;
  } else if (isOverextendedDown && momentumDecay.decaying && !stillAccelerating) {
    direction = 'long'; // panique qui s'essouffle -> contrarian long
    setupValid = score >= 55;
  }

  // --- Niveaux de risque (Module E) si setup valide ---
  let levels = null;
  if (setupValid) {
    const atr = computeATR(highs, lows, closes, 14);
    const stopDistance = atr * 1.5;
    const entry = lastClose;
    const stop = direction === 'long' ? entry - stopDistance : entry + stopDistance;
    const target = direction === 'long' ? entry + stopDistance * 1.5 : entry - stopDistance * 1.5; // RR 1.5:1, plus conservateur car stratégie contrarian
    levels = { entry, stop, target, rr: 1.5 };
  }

  return {
    ticker, lastClose, ret1h, ret4h, ret1d, volZScore, volumeRatio, priceExtension,
    acceleration, momentumDecay, hasRejection, score, details, direction, setupValid, levels,
    data,
  };
}

function computeATR(highs, lows, closes, period) {
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : 1;
}

// ------------------------------------------------------------
// RENDU
// ------------------------------------------------------------
function renderGrid(results, errors) {
  if (results.length === 0) {
    els.resultsContainer.innerHTML = `<div class="error-state">Aucune donnée récupérée.<br>${errors.map(escapeHtml).join('<br>')}</div>`;
    return;
  }

  // Trie : setups valides en premier, puis par score décroissant
  const sorted = [...results].sort((a, b) => {
    if (a.setupValid !== b.setupValid) return a.setupValid ? -1 : 1;
    return b.score - a.score;
  });

  const cards = sorted.map((r, idx) => {
    const cardClass = r.setupValid ? (r.direction === 'long' ? 'setup-long' : 'setup-short') : '';
    const badgeHtml = r.setupValid
      ? `<span class="setup-badge ${r.direction === 'long' ? 'badge-long' : 'badge-short'}">${r.direction === 'long' ? '▲ REVERSION LONG' : '▼ REVERSION SHORT'}</span>`
      : `<span class="setup-badge badge-none">Pas de setup</span>`;

    return `
      <div class="asset-card ${cardClass}" data-idx="${idx}">
        <div class="asset-card-header">
          <span class="asset-ticker">${r.ticker.replace('-USD', '')}</span>
          <span class="asset-price">${r.lastClose.toLocaleString('fr-BE', { maximumFractionDigits: r.lastClose < 10 ? 4 : 2 })}$</span>
        </div>
        ${badgeHtml}
        <div class="score-bar-track"><div class="score-bar-fill" style="width:${r.score}%"></div></div>
        <div class="asset-metrics">
          <div>1h <span class="metric-val ${r.ret1h >= 0 ? '' : ''}">${(r.ret1h * 100).toFixed(1)}%</span></div>
          <div>24h <span class="metric-val">${(r.ret1d * 100).toFixed(1)}%</span></div>
          <div>Extension <span class="metric-val">${(r.priceExtension * 100).toFixed(1)}%</span></div>
          <div>Volume <span class="metric-val">${r.volumeRatio.toFixed(1)}×</span></div>
          <div>Score <span class="metric-val">${r.score}/100</span></div>
          <div>Decay <span class="metric-val">${r.momentumDecay.decaying ? 'oui' : 'non'}</span></div>
        </div>
      </div>
    `;
  }).join('');

  els.resultsContainer.innerHTML = `
    ${errors.length > 0 ? `<div class="error-state" style="margin-bottom:16px;">${errors.map(escapeHtml).join('<br>')}</div>` : ''}
    <div class="asset-grid">${cards}</div>
  `;

  els.resultsContainer.querySelectorAll('.asset-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.idx, 10);
      renderDetail(sorted[idx]);
    });
  });
}

function renderDetail(r) {
  const detailsHtml = r.details.map(d => `
    <div class="reasoning-row">
      <span class="reasoning-icon icon-${d.icon}">${{ good: '✓', bad: '✗', warn: '~', neutral: 'ℹ' }[d.icon]}</span>
      <span>${escapeHtml(d.text)}</span>
    </div>
  `).join('');

  const levelsHtml = r.levels ? `
    <div class="detail-panel">
      <div class="detail-title">Niveaux de trade (${r.direction === 'long' ? 'Long contrarian' : 'Short contrarian'})</div>
      <div class="reasoning-row"><span>Entrée</span><span style="margin-left:auto; font-family:var(--mono); font-weight:700;">${r.levels.entry.toFixed(4)}</span></div>
      <div class="reasoning-row"><span>Stop-loss</span><span style="margin-left:auto; font-family:var(--mono); font-weight:700; color:var(--bear);">${r.levels.stop.toFixed(4)}</span></div>
      <div class="reasoning-row"><span>Take-profit (${r.levels.rr}:1)</span><span style="margin-left:auto; font-family:var(--mono); font-weight:700; color:var(--bull);">${r.levels.target.toFixed(4)}</span></div>
      <div class="reasoning-row" style="border-bottom:none;"><span style="font-size:11px; color:var(--text-dim);">RR volontairement plus conservateur (1.5:1) qu'en ORB — stratégie contrarian, momentum peut reprendre contre toi rapidement. Stratégie sélective : peu de trades, sors vite si l'excès continue malgré tout.</span></div>
    </div>
  ` : '';

  els.resultsContainer.innerHTML = `
    <button class="back-to-grid" id="back-to-grid-btn">← Retour à la grille</button>
    <div class="detail-panel">
      <div class="detail-title">${r.ticker.replace('-USD', '')} — Score ${r.score}/100 ${r.setupValid ? `— Setup ${r.direction === 'long' ? 'LONG' : 'SHORT'} valide` : '— Pas de setup valide'}</div>
      ${detailsHtml}
    </div>
    ${levelsHtml}
    <div id="chart-container"></div>
  `;

  document.getElementById('back-to-grid-btn').addEventListener('click', () => renderGrid(lastResults, []));
  renderDetailChart(r);
}

function renderDetailChart(r) {
  const container = document.getElementById('chart-container');
  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML = '<div class="empty-state">Graphique indisponible.</div>';
    return;
  }

  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 356,
    layout: { background: { color: 'transparent' }, textColor: '#6B6D73', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#1A1B1F' }, horzLines: { color: '#1A1B1F' } },
    rightPriceScale: { borderColor: '#24262B' },
    timeScale: { borderColor: '#24262B', timeVisible: true },
  });

  const candleSeries = chart.addCandlestickSeries({
    upColor: '#4A9B7F', downColor: '#C4554A', borderUpColor: '#4A9B7F', borderDownColor: '#C4554A',
    wickUpColor: '#4A9B7F', wickDownColor: '#C4554A',
  });

  const d = r.data;
  candleSeries.setData(d.timestamps.map((t, i) => ({ time: t, open: d.opens[i], high: d.highs[i], low: d.lows[i], close: d.closes[i] })));

  if (r.levels) {
    candleSeries.createPriceLine({ price: r.levels.entry, color: '#9B7FD4', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Entrée' });
    candleSeries.createPriceLine({ price: r.levels.stop, color: '#C4554A', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Stop' });
    candleSeries.createPriceLine({ price: r.levels.target, color: '#4A9B7F', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Target' });
  }

  chart.timeScale().fitContent();

  new ResizeObserver(entries => {
    if (entries.length === 0) return;
    chart.applyOptions({ width: entries[0].contentRect.width });
  }).observe(container);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
