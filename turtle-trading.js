// ============================================================
// TURTLE TRADING — Système 1 (20j) + Système 2 (55j), règles originales
// Richard Dennis & William Eckhardt, 1983
// ============================================================

const WORKER_URL = 'https://red-bush-d58eorbscanner.tom-vandendorpe.workers.dev/';

const UNIVERSE = [
  { ticker: '^GSPC', name: 'S&P 500', class: 'Indice actions US' },
  { ticker: '^NDX', name: 'Nasdaq 100', class: 'Indice actions US (tech)' },
  { ticker: 'GC=F', name: 'Or', class: 'Matière première' },
  { ticker: 'CL=F', name: 'Pétrole WTI', class: 'Matière première' },
  { ticker: 'EURUSD=X', name: 'EUR/USD', class: 'Devise' },
  { ticker: 'TLT', name: 'Obligations US 20y+', class: 'Obligataire' },
];

const RISK_PCT = 1; // % de la balance risqué par unité (2N stop = 1 "unit" de risque Turtle classique)

const els = {
  scanBtn: document.getElementById('scan-btn'),
  resultsContainer: document.getElementById('results-container'),
  balanceBar: document.getElementById('balance-bar'),
};

els.scanBtn.addEventListener('click', runScan);

let lastResults = [];

// ------------------------------------------------------------
// BALANCE & GESTION DU RISQUE — même mécanisme que le scanner ORB
// ------------------------------------------------------------
const BALANCE_KEY = 'turtle-balance';
const RISK_PCT_KEY = 'turtle-risk-pct';
const DEFAULT_RISK_PCT = 1;

function loadBalance() {
  try { const raw = localStorage.getItem(BALANCE_KEY); return raw ? parseFloat(raw) : null; } catch { return null; }
}
function saveBalance(v) { try { localStorage.setItem(BALANCE_KEY, String(v)); } catch {} }
function loadRiskPct() {
  try { const raw = localStorage.getItem(RISK_PCT_KEY); return raw ? parseFloat(raw) : DEFAULT_RISK_PCT; } catch { return DEFAULT_RISK_PCT; }
}
function saveRiskPct(v) { try { localStorage.setItem(RISK_PCT_KEY, String(v)); } catch {} }

let userBalance = loadBalance();
let riskPct = loadRiskPct();

function renderBalanceBar() {
  if (userBalance === null) {
    els.balanceBar.innerHTML = `<div class="balance-bar"><span class="balance-label">Balance :</span><span class="balance-not-set" id="set-balance-link">renseigner ma balance pour calculer la taille de position optimale</span></div>`;
    document.getElementById('set-balance-link').addEventListener('click', promptEditBalance);
    return;
  }
  els.balanceBar.innerHTML = `
    <div class="balance-bar">
      <span class="balance-label">Balance :</span>
      <span class="balance-value" id="balance-display">${userBalance.toLocaleString('fr-BE', { maximumFractionDigits: 0 })} $</span>
      <span class="risk-pct">Risque par unité (2N) :</span>
      <span class="risk-pct-value" id="risk-pct-display">${riskPct}%</span>
    </div>`;
  document.getElementById('balance-display').addEventListener('click', promptEditBalance);
  document.getElementById('risk-pct-display').addEventListener('click', promptEditRiskPct);
}

function promptEditBalance() {
  const input = prompt('Ta balance de trading actuelle ($) :', userBalance !== null ? userBalance : '');
  if (input === null) return;
  const value = parseFloat(input.replace(',', '.'));
  if (isNaN(value) || value <= 0) { alert('Montant invalide.'); return; }
  userBalance = value; saveBalance(value); renderBalanceBar();
  if (lastResults.length > 0) renderGrid(lastResults, []); // recalcule l'affichage si un scan existe déjà
}

function promptEditRiskPct() {
  const input = prompt('Pourcentage de la balance à risquer par unité (%) :', riskPct);
  if (input === null) return;
  const value = parseFloat(input.replace(',', '.'));
  if (isNaN(value) || value <= 0 || value > 100) { alert('Pourcentage invalide.'); return; }
  riskPct = value; saveRiskPct(value); renderBalanceBar();
  if (lastResults.length > 0) renderGrid(lastResults, []);
}

renderBalanceBar();

// Calcule le montant à investir pour respecter le risque défini, sur la base de la
// distance du stop (2N) — même principe que le scanner ORB : jamais plus que la balance.
function computePositionSize(entry, stop) {
  if (userBalance === null) return null;
  const riskAmount = userBalance * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  if (stopDistance <= 0) return null;

  let shares = riskAmount / stopDistance;
  let positionValue = shares * entry;

  const balanceCapped = positionValue > userBalance;
  if (balanceCapped) {
    positionValue = userBalance;
    shares = positionValue / entry;
  }
  const actualRiskAmount = shares * stopDistance;

  return { shares, riskAmount: actualRiskAmount, targetRiskAmount: riskAmount, stopDistance, positionValue, balanceCapped };
}

// ------------------------------------------------------------
// ORCHESTRATION
// ------------------------------------------------------------
async function runScan() {
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = 'Scan en cours...';
  els.resultsContainer.innerHTML = `<div class="empty-state"><div class="glyph">◫</div><p>Récupération et analyse en cours...</p></div>`;

  const results = [];
  const errors = [];

  for (const asset of UNIVERSE) {
    try {
      const raw = await fetchDailyData(asset.ticker);
      const parsed = parseYahooResponse(raw);
      if (!parsed || parsed.closes.length < 60) {
        errors.push(`${asset.name}: données insuffisantes`);
        continue;
      }
      const analysis = analyzeAsset(asset, parsed);
      results.push(analysis);
    } catch (e) {
      errors.push(`${asset.name}: ${e.message}`);
    }
  }

  lastResults = results;
  els.scanBtn.disabled = false;
  els.scanBtn.textContent = 'Scanner les marchés';
  renderGrid(results, errors);
}

// ------------------------------------------------------------
// FETCH
// ------------------------------------------------------------
async function fetchDailyData(ticker) {
  const url = `${WORKER_URL}?ticker=${encodeURIComponent(ticker)}&interval=1d&range=1y`;
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
// DONCHIAN CHANNEL
// ------------------------------------------------------------
function donchianHigh(highs, period, endIdxExclusive) {
  const start = Math.max(0, endIdxExclusive - period);
  return Math.max(...highs.slice(start, endIdxExclusive));
}

function donchianLow(lows, period, endIdxExclusive) {
  const start = Math.max(0, endIdxExclusive - period);
  return Math.min(...lows.slice(start, endIdxExclusive));
}

// N = ATR sur 20 jours, la mesure de volatilité utilisée pour le sizing et le stop (règle Turtle originale)
function computeN(highs, lows, closes, period = 20) {
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : (highs[highs.length - 1] - lows[lows.length - 1]);
}

// ------------------------------------------------------------
// ANALYSE — logique Turtle fidèle à l'originale
// ------------------------------------------------------------
function analyzeAsset(asset, data) {
  const { closes, highs, lows, timestamps } = data;
  const n = closes.length;
  const lastClose = closes[n - 1];

  const N = computeN(highs, lows, closes, 20);

  // Système 1 : breakout 20 jours, sortie sur contre-breakout 10 jours
  const donchian20High = donchianHigh(highs, 20, n - 1); // exclut la bougie du jour (comparaison correcte)
  const donchian20Low = donchianLow(lows, 20, n - 1);
  const sys1Long = lastClose > donchian20High;
  const sys1Short = lastClose < donchian20Low;

  // Règle du "skip si le précédent signal 20j était gagnant" (Système 1 uniquement) —
  // approximé ici en vérifiant si un breakout dans le même sens s'est déjà produit dans
  // les 20 dernières séances ET si le prix a progressé depuis dans ce sens (= aurait été gagnant).
  const priorBreakoutInfo = checkPriorBreakout(closes, highs, lows, n, 20, sys1Long ? 'long' : sys1Short ? 'short' : null);

  // Système 2 : breakout 55 jours, toujours suivi (pas de règle de skip)
  const donchian55High = donchianHigh(highs, 55, n - 1);
  const donchian55Low = donchianLow(lows, 55, n - 1);
  const sys2Long = lastClose > donchian55High;
  const sys2Short = lastClose < donchian55Low;

  // Niveaux de sortie (Donchian inverse)
  const exitLongLevel = donchianLow(lows, 10, n - 1); // sortie long sur creux 10j (Système 1) — utilisé aussi comme référence générale
  const exitShortLevel = donchianHigh(highs, 10, n - 1);

  let signal = 'none';
  let system = null;
  const details = [];

  if (sys1Long && !priorBreakoutInfo.skip) {
    signal = 'long'; system = 1;
    details.push({ icon: 'good', text: `Cassure du plus haut sur 20 jours (${donchian20High.toFixed(2)}) — Système 1` });
  } else if (sys1Long && priorBreakoutInfo.skip) {
    details.push({ icon: 'warn', text: `Cassure 20j détectée mais IGNORÉE — le précédent breakout dans ce sens était déjà gagnant (règle anti-whipsaw du Système 1)` });
  }

  if (sys1Short && !priorBreakoutInfo.skip && signal === 'none') {
    signal = 'short'; system = 1;
    details.push({ icon: 'good', text: `Cassure du plus bas sur 20 jours (${donchian20Low.toFixed(2)}) — Système 1` });
  } else if (sys1Short && priorBreakoutInfo.skip && signal === 'none') {
    details.push({ icon: 'warn', text: `Cassure 20j détectée mais IGNORÉE — le précédent breakout dans ce sens était déjà gagnant` });
  }

  // Système 2 prime si Système 1 a été skippé ou n'a rien donné (cohérent avec la pratique
  // Turtle de suivre le signal 55j même quand le 20j est filtré)
  if (sys2Long && signal === 'none') {
    signal = 'long'; system = 2;
    details.push({ icon: 'good', text: `Cassure du plus haut sur 55 jours (${donchian55High.toFixed(2)}) — Système 2, toujours suivi` });
  } else if (sys2Short && signal === 'none') {
    signal = 'short'; system = 2;
    details.push({ icon: 'good', text: `Cassure du plus bas sur 55 jours (${donchian55Low.toFixed(2)}) — Système 2, toujours suivi` });
  }

  if (signal === 'none') {
    details.push({ icon: 'neutral', text: `Prix dans le canal — pas de cassure sur 20j (${donchian20Low.toFixed(2)}–${donchian20High.toFixed(2)}) ni 55j (${donchian55Low.toFixed(2)}–${donchian55High.toFixed(2)})` });
  }

  details.push({ icon: 'neutral', text: `N (ATR 20j, mesure de volatilité) = ${N.toFixed(2)} — sert au stop et au dimensionnement` });

  // --- Niveaux de risque, règles Turtle originales ---
  let levels = null;
  if (signal !== 'none') {
    const entry = lastClose;
    const stopDistance = 2 * N; // stop initial à 2N, règle Turtle
    const stop = signal === 'long' ? entry - stopDistance : entry + stopDistance;
    // Sortie de tendance : Donchian inverse (10j pour Système 1, 20j pour Système 2)
    const exitPeriod = system === 1 ? 10 : 20;
    const trendExitLevel = signal === 'long' ? donchianLow(lows, exitPeriod, n - 1) : donchianHigh(highs, exitPeriod, n - 1);

    levels = { entry, stop, stopDistance, N, trendExitLevel, exitPeriod, system };
  }

  return {
    ticker: asset.ticker, name: asset.name, assetClass: asset.class,
    lastClose, signal, system, N, details, levels, data,
  };
}

// Vérifie si un breakout dans le même sens a eu lieu récemment et si, depuis, le prix a
// progressé dans ce sens (= le breakout précédent aurait été gagnant) — approximation de
// la règle Turtle "skip le signal si le précédent trade dans ce marché était gagnant".
function checkPriorBreakout(closes, highs, lows, n, lookback, direction) {
  if (!direction) return { skip: false };

  for (let i = n - 2; i >= Math.max(0, n - 1 - lookback); i--) {
    const priorHigh20 = donchianHigh(highs, 20, i);
    const priorLow20 = donchianLow(lows, 20, i);
    const wasLongBreakout = closes[i] > priorHigh20;
    const wasShortBreakout = closes[i] < priorLow20;

    if (direction === 'long' && wasLongBreakout) {
      const wasWinning = closes[n - 1] > closes[i]; // le prix a continué à monter depuis
      return { skip: wasWinning, priorIdx: i };
    }
    if (direction === 'short' && wasShortBreakout) {
      const wasWinning = closes[n - 1] < closes[i];
      return { skip: wasWinning, priorIdx: i };
    }
  }
  return { skip: false };
}

// ------------------------------------------------------------
// RENDU
// ------------------------------------------------------------
function renderGrid(results, errors) {
  if (results.length === 0) {
    els.resultsContainer.innerHTML = `<div class="error-state">Aucune donnée récupérée.<br>${errors.map(escapeHtml).join('<br>')}</div>`;
    return;
  }

  const sorted = [...results].sort((a, b) => {
    if ((a.signal !== 'none') !== (b.signal !== 'none')) return a.signal !== 'none' ? -1 : 1;
    return 0;
  });

  const cards = sorted.map((r, idx) => {
    const hasSetup = r.signal !== 'none';
    const cardClass = hasSetup ? (r.signal === 'long' ? 'setup-long' : 'setup-short') : '';
    const badgeHtml = hasSetup
      ? `<span class="setup-badge ${r.signal === 'long' ? 'badge-long' : 'badge-short'}">${r.signal === 'long' ? '▲ LONG' : '▼ SHORT'} · Système ${r.system}</span>`
      : `<span class="setup-badge badge-none">Pas de cassure</span>`;

    return `
      <div class="asset-card ${cardClass}" data-idx="${idx}">
        <div class="asset-card-header">
          <span class="asset-ticker">${r.name}</span>
          <span class="asset-price">${r.lastClose.toLocaleString('fr-BE', { maximumFractionDigits: r.lastClose < 10 ? 4 : 2 })}</span>
        </div>
        <div class="asset-class">${r.assetClass}</div>
        ${badgeHtml}
        <div class="asset-metrics">
          <div>N (ATR20) <span class="metric-val">${r.N.toFixed(2)}</span></div>
          <div>Stop (2N) <span class="metric-val">${(r.N * 2).toFixed(2)}</span></div>
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

  const sizing = r.levels ? computePositionSize(r.levels.entry, r.levels.stop) : null;
  const sizingHtml = r.levels ? renderSizingBlock(sizing) : '';

  const levelsHtml = r.levels ? `
    <div class="detail-panel">
      <div class="detail-title">Niveaux de trade (${r.signal === 'long' ? 'Long' : 'Short'} — Système ${r.levels.system})</div>
      <div class="reasoning-row"><span>Entrée</span><span style="margin-left:auto; font-family:var(--mono); font-weight:700;">${r.levels.entry.toFixed(4)}</span></div>
      <div class="reasoning-row"><span>Stop-loss (2N) — FIXE, ne bouge pas</span><span style="margin-left:auto; font-family:var(--mono); font-weight:700; color:var(--bear);">${r.levels.stop.toFixed(4)}</span></div>
      <div class="reasoning-row"><span>Sortie de tendance actuelle (Donchian ${r.levels.exitPeriod}j inverse)</span><span style="margin-left:auto; font-family:var(--mono); font-weight:700; color:var(--warn);">${r.levels.trendExitLevel.toFixed(4)}</span></div>
      ${sizingHtml}
      <div class="exit-tracker-note">
        <strong>⚠ Comment sortir de ce trade — pas de TP fixe :</strong><br>
        Ce système n'a volontairement <strong>aucun take-profit fixe</strong>. Tu sors sur le PREMIER des deux niveaux touché :<br>
        1) le <strong>stop 2N ci-dessus, qui est fixe</strong> une fois le trade pris — pose-le tel quel chez ton broker et ne le bouge pas ;<br>
        2) la <strong>« sortie de tendance »</strong> — qui elle <strong>change chaque jour</strong> car elle suit le canal Donchian inverse. Tant que le trade reste ouvert, reviens sur cette page pour rescanner et voir où ce niveau se trouve désormais.<br>
        Concrètement : le trade reste ouvert tant qu'aucun des deux niveaux n'est touché, potentiellement plusieurs semaines — c'est la philosophie Turtle : laisser courir les gagnants.
      </div>
    </div>
  ` : '';

  els.resultsContainer.innerHTML = `
    <button class="back-to-grid" id="back-to-grid-btn">← Retour à la grille</button>
    <div class="detail-panel">
      <div class="detail-title">${r.name} (${r.ticker}) ${r.signal !== 'none' ? `— Setup ${r.signal === 'long' ? 'LONG' : 'SHORT'} — Système ${r.system}` : '— Pas de signal'}</div>
      ${detailsHtml}
    </div>
    ${levelsHtml}
    <div id="chart-container"></div>
  `;

  document.getElementById('back-to-grid-btn').addEventListener('click', () => renderGrid(lastResults, []));
  renderDetailChart(r);
}

function renderSizingBlock(sizing) {
  if (!sizing) {
    return `<div class="position-size-row"><span class="label">Montant à investir</span><span class="value" style="color:var(--text-dim); font-weight:400;">renseigne ta balance en haut de page</span></div>`;
  }
  if (sizing.balanceCapped) {
    const actualRiskPct = (sizing.riskAmount / userBalance) * 100;
    return `<div class="position-size-row" style="flex-direction:column; align-items:stretch; gap:4px;">
      <div style="display:flex; justify-content:space-between;"><span class="label">Montant à investir</span><span class="value">${sizing.positionValue.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$ <span style="color:var(--text-dim); font-weight:400; font-size:11px;">(= toute ta balance)</span></span></div>
      <div style="font-size:11px; color:var(--warn); font-family:var(--sans);">⚠ Stop trop large (2N) pour respecter ${riskPct}% avec cette balance — risque réel ~${actualRiskPct.toFixed(1)}% (${sizing.riskAmount.toFixed(2)}$) si tout le capital est engagé</div>
    </div>`;
  }
  return `<div class="position-size-row"><span class="label">Montant à investir (${riskPct}% risqué)</span><span class="value">${sizing.positionValue.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$ <span style="color:var(--text-dim); font-weight:400; font-size:11px;">(${sizing.shares.toFixed(4)} unités · ~${sizing.riskAmount.toFixed(2)}$ risqués si stop 2N touché)</span></span></div>`;
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
    timeScale: { borderColor: '#24262B', timeVisible: false },
  });

  const candleSeries = chart.addCandlestickSeries({
    upColor: '#4A9B7F', downColor: '#C4554A', borderUpColor: '#4A9B7F', borderDownColor: '#C4554A',
    wickUpColor: '#4A9B7F', wickDownColor: '#C4554A',
  });

  const d = r.data;
  candleSeries.setData(d.timestamps.map((t, i) => ({ time: t, open: d.opens[i], high: d.highs[i], low: d.lows[i], close: d.closes[i] })));

  if (r.levels) {
    candleSeries.createPriceLine({ price: r.levels.entry, color: '#5FA8A0', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Entrée' });
    candleSeries.createPriceLine({ price: r.levels.stop, color: '#C4554A', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Stop 2N' });
    candleSeries.createPriceLine({ price: r.levels.trendExitLevel, color: '#D4A24C', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Sortie tendance' });
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
