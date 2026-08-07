// ============================================================
// ORB SCANNER — logique principale
// ============================================================

const CORS_PROXIES = [
  {
    name: 'cloudflare-worker',
    build: (url) => {
      const ticker = new URL(url).pathname.split('/').pop();
      return `https://red-bush-d58eorbscanner.tom-vandendorpe.workers.dev/?ticker=${ticker}`;
    },
    parse: (text) => JSON.parse(text),
  },
  {
    name: 'allorigins-get',
    build: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    parse: (text) => JSON.parse(JSON.parse(text).contents),
  },
  {
    name: 'corsproxy.io',
    build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    parse: (text) => JSON.parse(text),
  },
  {
    name: 'allorigins-raw',
    build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    parse: (text) => JSON.parse(text),
  },
  {
    name: 'codetabs',
    build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    parse: (text) => JSON.parse(text),
  },
];

const els = {
  input: document.getElementById('ticker-input'),
  orbWindow: document.getElementById('orb-window'),
  btn: document.getElementById('search-btn'),
  content: document.getElementById('content'),
  watchlistBar: document.getElementById('watchlist-bar'),
  sessionStatusBar: document.getElementById('session-status-bar'),
  balanceBar: document.getElementById('balance-bar'),
  dataSourceBadge: document.getElementById('data-source-badge'),
};

const SESSION_START_MIN = 9 * 60 + 30;
const SESSION_END_MIN = 11 * 60;

function getMarketTimeInfo() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const weekday = parts.find(p => p.type === 'weekday').value;
  const totalMin = hour * 60 + minute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  return { totalMin, isWeekend, hour, minute };
}

function renderSessionStatus() {
  const { totalMin, isWeekend } = getMarketTimeInfo();
  const formatLocalTime = (marketMinutes) => {
    const now = new Date();
    const marketNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const diffFromMarketMidnight = marketMinutes - (marketNow.getHours() * 60 + marketNow.getMinutes());
    const target = new Date(now.getTime() + diffFromMarketMidnight * 60000);
    return target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  let html;
  if (isWeekend) {
    html = `<div class="session-status session-closed"><span class="dot"></span>Marché fermé (week-end)<span class="session-detail">La fenêtre ORB reprendra lundi à l'ouverture</span></div>`;
  } else if (totalMin < SESSION_START_MIN) {
    const untilOpen = SESSION_START_MIN - totalMin;
    html = `<div class="session-status session-upcoming"><span class="dot"></span>Ouverture dans ${Math.floor(untilOpen / 60)}h${String(untilOpen % 60).padStart(2, '0')}<span class="session-detail">Fenêtre de trading : ${formatLocalTime(SESSION_START_MIN)} – ${formatLocalTime(SESSION_END_MIN)} (ton heure locale)</span></div>`;
  } else if (totalMin <= SESSION_END_MIN) {
    const remaining = SESSION_END_MIN - totalMin;
    html = `<div class="session-status session-active"><span class="dot"></span>Dans la fenêtre — ${Math.floor(remaining / 60)}h${String(remaining % 60).padStart(2, '0')} restantes<span class="session-detail">C'est le moment de scanner ta watchlist</span></div>`;
  } else {
    html = `<div class="session-status session-closed"><span class="dot"></span>Fenêtre fermée pour aujourd'hui<span class="session-detail">L'edge ORB s'érode après 1h30 — pas la peine de rester devant l'écran</span></div>`;
  }
  els.sessionStatusBar.innerHTML = html;
}

renderSessionStatus();
setInterval(renderSessionStatus, 60000);

const BALANCE_KEY = 'orb-scanner-balance';
const RISK_PCT_KEY = 'orb-scanner-risk-pct';
const DEFAULT_RISK_PCT = 1;

function loadBalance() {
  try { const raw = localStorage.getItem(BALANCE_KEY); return raw ? parseFloat(raw) : null; } catch { return null; }
}
function saveBalance(value) { try { localStorage.setItem(BALANCE_KEY, String(value)); } catch {} }
function loadRiskPct() {
  try { const raw = localStorage.getItem(RISK_PCT_KEY); return raw ? parseFloat(raw) : DEFAULT_RISK_PCT; } catch { return DEFAULT_RISK_PCT; }
}
function saveRiskPct(value) { try { localStorage.setItem(RISK_PCT_KEY, String(value)); } catch {} }

let userBalance = loadBalance();
let riskPct = loadRiskPct();

function renderBalanceBar() {
  if (userBalance === null) {
    els.balanceBar.innerHTML = `
      <div class="balance-bar">
        <span class="balance-label">Balance :</span>
        <span class="balance-not-set" id="set-balance-link" style="cursor:pointer; text-decoration:underline;">renseigner ma balance pour calculer la taille de position optimale</span>
      </div>`;
    document.getElementById('set-balance-link').addEventListener('click', promptEditBalance);
    return;
  }
  els.balanceBar.innerHTML = `
    <div class="balance-bar">
      <span class="balance-label">Balance :</span>
      <span class="balance-value" id="balance-display">${userBalance.toLocaleString('fr-BE', { maximumFractionDigits: 0 })} $</span>
      <span class="risk-pct">Risque par trade :</span>
      <span class="risk-pct-value" id="risk-pct-display">${riskPct}%</span>
      <span class="risk-pct" style="margin-left:auto; color:var(--text-dim);">(${(userBalance * riskPct / 100).toLocaleString('fr-BE', { maximumFractionDigits: 0 })} $ risqués / trade)</span>
    </div>`;
  document.getElementById('balance-display').addEventListener('click', promptEditBalance);
  document.getElementById('risk-pct-display').addEventListener('click', promptEditRiskPct);
}

function promptEditBalance() {
  const input = prompt('Ta balance de trading actuelle ($) :', userBalance !== null ? userBalance : '');
  if (input === null) return;
  const value = parseFloat(input.replace(',', '.'));
  if (isNaN(value) || value <= 0) { alert('Montant invalide.'); return; }
  userBalance = value;
  saveBalance(value);
  renderBalanceBar();
}

function promptEditRiskPct() {
  const input = prompt('Pourcentage de la balance à risquer par trade (%) :', riskPct);
  if (input === null) return;
  const value = parseFloat(input.replace(',', '.'));
  if (isNaN(value) || value <= 0 || value > 100) { alert('Pourcentage invalide.'); return; }
  riskPct = value;
  saveRiskPct(value);
  renderBalanceBar();
}

renderBalanceBar();

function computePositionSize(entry, stop) {
  if (userBalance === null) return null;
  const riskAmount = userBalance * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  if (stopDistance <= 0) return null;
  let shares = riskAmount / stopDistance;
  let positionValue = shares * entry;
  const balanceCapped = positionValue > userBalance;
  if (balanceCapped) { positionValue = userBalance; shares = positionValue / entry; }
  const actualRiskAmount = shares * stopDistance;
  return { shares, riskAmount: actualRiskAmount, targetRiskAmount: riskAmount, stopDistance, positionValue, balanceCapped };
}

let chart = null;
let candleSeries = null;

const WATCHLIST_KEY = 'orb-scanner-watchlist';
let watchlist = loadWatchlist();

function loadWatchlist() {
  try { const raw = localStorage.getItem(WATCHLIST_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function saveWatchlist() { try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); } catch {} }

function addToWatchlist(ticker) {
  ticker = ticker.trim().toUpperCase();
  if (!ticker || watchlist.includes(ticker)) return;
  watchlist.push(ticker);
  saveWatchlist();
  renderWatchlistBar();
}

function removeFromWatchlist(ticker) {
  watchlist = watchlist.filter(t => t !== ticker);
  saveWatchlist();
  renderWatchlistBar();
}

function renderWatchlistBar() {
  const chips = watchlist.map(t => `
    <div class="watchlist-chip" data-ticker="${t}">
      ${t}
      <button data-remove="${t}" title="Retirer">×</button>
    </div>
  `).join('');
  els.watchlistBar.innerHTML = `
    ${chips}
    <div class="watchlist-add">
      <input type="text" id="watchlist-input" placeholder="+ ticker" maxlength="10">
      <button id="watchlist-add-btn">Ajouter</button>
    </div>
    <button id="scan-all-btn" ${watchlist.length === 0 ? 'disabled' : ''}>⚡ Scanner tout (${watchlist.length})</button>
  `;
  els.watchlistBar.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removeFromWatchlist(btn.dataset.remove); });
  });
  const wInput = document.getElementById('watchlist-input');
  const wAddBtn = document.getElementById('watchlist-add-btn');
  wAddBtn.addEventListener('click', () => { addToWatchlist(wInput.value); wInput.value = ''; wInput.focus(); });
  wInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { addToWatchlist(wInput.value); wInput.value = ''; } });
  document.getElementById('scan-all-btn')?.addEventListener('click', runScanAll);
  els.watchlistBar.querySelectorAll('.watchlist-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      els.input.value = chip.dataset.ticker;
      runAnalysis();
    });
  });
}

renderWatchlistBar();

els.btn.addEventListener('click', runAnalysis);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });
document.getElementById('history-btn').addEventListener('click', renderHistoryPage);

// ------------------------------------------------------------
// CACHE DE RÉSULTATS — évite de rescanner en réseau si le résultat a moins
// d'1 minute. En mémoire (Map), donc réinitialisé à chaque rechargement de
// page — mais évite les rescans inutiles si tu navigues entre les vues
// (détail d'un ticker <-> tableau groupé) dans la même session sans attendre.
// ------------------------------------------------------------
const analysisCache = new Map(); // clé: "TICKER|orbMinutes" -> { parsed, analysis, cachedAt }
const CACHE_MAX_AGE_MS = 60 * 1000; // 1 minute

async function analyzeTicker(ticker, orbMinutes) {
  const cacheKey = `${ticker}|${orbMinutes}`;
  const cached = analysisCache.get(cacheKey);

  if (cached && (Date.now() - cached.cachedAt) < CACHE_MAX_AGE_MS) {
    return { parsed: cached.parsed, analysis: cached.analysis };
  }

  const raw = await fetchYahooData(ticker);
  const parsed = parseYahooResponse(raw);
  if (!parsed || parsed.closes.length < 20) {
    throw new Error('Pas assez de données intraday (marché fermé ou ticker invalide)');
  }
  const analysis = computeIndicators(parsed, orbMinutes);

  analysisCache.set(cacheKey, { parsed, analysis, cachedAt: Date.now() });

  return { parsed, analysis };
}

async function runAnalysis() {
  const ticker = els.input.value.trim().toUpperCase();
  if (!ticker) return;
  const orbMinutes = parseInt(els.orbWindow.value, 10);
  setLoading(ticker);
  els.btn.disabled = true;
  try {
    const { parsed, analysis } = await analyzeTicker(ticker, orbMinutes);
    renderResults(ticker, parsed, analysis, orbMinutes);
  } catch (err) {
    setError(ticker, err.message);
  } finally {
    els.btn.disabled = false;
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const SCAN_BATCH_SIZE = 4;
const SCAN_BATCH_DELAY_MS = 8000;

async function runScanAll() {
  if (watchlist.length === 0) return;
  const orbMinutes = parseInt(els.orbWindow.value, 10);
  const scanBtn = document.getElementById('scan-all-btn');
  if (scanBtn) { scanBtn.disabled = true; }

  const results = {};
  watchlist.forEach(t => { results[t] = { status: 'loading' }; });
  renderScanTable(results, orbMinutes);

  const batches = [];
  for (let i = 0; i < watchlist.length; i += SCAN_BATCH_SIZE) {
    batches.push(watchlist.slice(i, i + SCAN_BATCH_SIZE));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    if (scanBtn) scanBtn.textContent = `⚡ Scan en cours... (${b * SCAN_BATCH_SIZE}/${watchlist.length})`;
    await Promise.all(batch.map(async (ticker) => {
      try {
        const { analysis } = await analyzeTicker(ticker, orbMinutes);
        results[ticker] = { status: 'done', analysis };
      } catch (err) {
        results[ticker] = { status: 'error', message: err.message };
      }
      renderScanTable(results, orbMinutes);
    }));
    if (b < batches.length - 1) await sleep(SCAN_BATCH_DELAY_MS);
  }

  if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = `⚡ Scanner tout (${watchlist.length})`; }
}

function renderScanTable(results, orbMinutes) {
  const rows = watchlist.map(ticker => {
    const r = results[ticker];
    if (!r || r.status === 'loading') {
      return `<tr class="scan-row" data-ticker="${ticker}"><td class="scan-ticker">${ticker}</td><td colspan="6"><span class="scan-signal-cell"><span class="scan-signal-dot dot-loading"></span>Analyse en cours...</span></td></tr>`;
    }
    if (r.status === 'error') {
      return `<tr class="scan-row" data-ticker="${ticker}"><td class="scan-ticker">${ticker}</td><td colspan="6"><span class="scan-signal-cell"><span class="scan-signal-dot dot-error"></span>${escapeHtml(r.message)}</span></td></tr>`;
    }
    const a = r.analysis;
    const signalMeta = {
      bull: { dot: 'dot-bull', label: 'BREAKOUT HAUSSIER', row: 'row-bull' },
      bear: { dot: 'dot-bear', label: 'BREAKOUT BAISSIER', row: 'row-bear' },
      neutral: { dot: 'dot-neutral', label: 'Neutre', row: '' },
    }[a.signal];
    const change = a.lastClose - a.prevClose;
    const changePct = (change / a.prevClose) * 100;
    const isUp = change >= 0;
    const gradeColors = { S: 'var(--bull)', A: 'var(--bull)', B: 'var(--warn)', C: 'var(--warn)', D: 'var(--bear)', E: 'var(--bear)' };
    const scoreColor = gradeColors[a.setupScore.grade] || 'var(--text-dim)';
    const scoreCell = `<span style="font-weight:700; color:${scoreColor};">${a.setupScore.grade}</span>${a.setupScore.isNeutral ? '<span style="color:var(--text-dim); font-size:11px;"> (approche)</span>' : ''}`;
    return `<tr class="scan-row ${signalMeta.row}" data-ticker="${ticker}"><td class="scan-ticker">${ticker}</td><td><span class="scan-signal-cell"><span class="scan-signal-dot ${signalMeta.dot}"></span>${signalMeta.label}</span></td><td>${scoreCell}</td><td>${a.lastClose.toFixed(2)}</td><td class="${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${changePct.toFixed(2)}%</td><td>ADX ${a.adx.toFixed(0)}</td><td>Vol ${a.relativeVolume.toFixed(1)}x</td></tr>`;
  }).join('');

  els.content.innerHTML = `
    <table class="scan-table">
      <thead><tr><th>Ticker</th><th>Signal</th><th>Score</th><th>Prix</th><th>Var. jour</th><th>ADX</th><th>Vol. relatif</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  els.content.querySelectorAll('.scan-row').forEach(row => {
    const ticker = row.dataset.ticker;
    if (results[ticker]?.status === 'done') {
      row.addEventListener('click', () => { els.input.value = ticker; runAnalysis(); });
    }
  });
}

// ------------------------------------------------------------
// INDICATEUR DE SOURCE DE DONNÉES — Yahoo (principal) vs Twelve Data (fallback)
// ------------------------------------------------------------
let lastKnownSource = null; // 'yahoo' | 'twelvedata-fallback' | null

function renderDataSourceBadge() {
  if (!els.dataSourceBadge) return;
  if (lastKnownSource === 'yahoo') {
    els.dataSourceBadge.innerHTML = `<span class="data-source-badge src-yahoo"><span class="src-dot"></span>Yahoo</span>`;
  } else if (lastKnownSource === 'twelvedata-fallback') {
    els.dataSourceBadge.innerHTML = `<span class="data-source-badge src-twelvedata" title="Yahoo indisponible, Twelve Data utilisé en secours"><span class="src-dot"></span>Twelve Data (secours)</span>`;
  } else {
    els.dataSourceBadge.innerHTML = `<span class="data-source-badge src-unknown"><span class="src-dot"></span>Source : —</span>`;
  }
}

renderDataSourceBadge();

async function fetchYahooData(ticker) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=5d`;
  const failures = [];
  for (const proxy of CORS_PROXIES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(proxy.build(yahooUrl), { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Le badge de source est lisible uniquement via notre Worker Cloudflare (les
      // proxies de secours de la liste ne fournissent pas cet en-tête).
      if (proxy.name === 'cloudflare-worker') {
        const src = res.headers.get('X-Data-Source');
        if (src) { lastKnownSource = src; renderDataSourceBadge(); }
      }

      const text = await res.text();
      const data = proxy.parse(text);
      if (data?.chart?.error) throw new Error(data.chart.error.description || 'Ticker introuvable');
      if (!data?.chart?.result?.[0]) throw new Error('Réponse vide');
      return data;
    } catch (e) {
      failures.push(`${proxy.name}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
      continue;
    }
  }
  throw new Error(`Tous les proxies ont échoué — ${failures.join(' / ')}`);
}

function parseYahooResponse(raw) {
  const result = raw.chart.result[0];
  const meta = result.meta;
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  if (!timestamps || !quote) return null;
  const out = { meta, timestamps: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
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

function computeSetupScore({ signal, lastClose, orbHigh, orbLow, orbRange, atr, adx, relativeVolume, priceAboveVwap, persistence }) {
  const distToHigh = orbHigh - lastClose;
  const distToLow = lastClose - orbLow;
  const isNeutral = signal === 'neutral';
  const isLong = isNeutral ? (distToHigh <= distToLow) : (signal === 'bull');
  let points = 0;
  const maxPoints = 28;
  const details = [];
  if (isNeutral) details.push(`ℹ Pas de breakout confirmé actuellement — score indicatif côté ${isLong ? 'haussier (ORB High)' : 'baissier (ORB Low)'}, le plus proche`);

  const MIN_MINUTES_FOR_TOP_GRADE = 10;
  let notYetConfirmedByTime = false;
  if (!persistence) {
    points += 0; details.push(`ℹ Pas encore assez de bougies closes depuis l'ouverture pour évaluer la tenue du niveau`);
    notYetConfirmedByTime = true;
  } else if (persistence.minutesSinceBreakout < MIN_MINUTES_FOR_TOP_GRADE) {
    points += 0; details.push(`✗ Breakout trop récent (${persistence.minutesSinceBreakout} min, minimum ${MIN_MINUTES_FOR_TOP_GRADE} min requis) — risque élevé de fakeout, pas encore confirmé par la durée`);
    notYetConfirmedByTime = true;
  } else if (persistence.minutesSinceBreakout < 20) {
    points += 4; details.push(`✓ Niveau tenu depuis ${persistence.minutesSinceBreakout} min sans retour dans le range`);
  } else {
    points += 6; details.push(`✓ Niveau tenu depuis ${persistence.minutesSinceBreakout} min — breakout confirmé par la durée`);
  }

  const rangeToAtrRatio = orbRange / atr;
  if (rangeToAtrRatio >= 0.8 && rangeToAtrRatio <= 2.5) {
    points += 5; details.push(`✓ Range ORB bien proportionné à la volatilité (${rangeToAtrRatio.toFixed(1)}× ATR)`);
  } else if (rangeToAtrRatio < 0.8) {
    points += 2; details.push(`⚠ Range ORB étroit vs volatilité normale (${rangeToAtrRatio.toFixed(1)}× ATR) — risque de fakeout plus élevé`);
  } else {
    points += 2; details.push(`⚠ Range ORB très large (${rangeToAtrRatio.toFixed(1)}× ATR) — stop potentiellement coûteux`);
  }

  if (adx > 30) {
    points += 5; details.push(`✓ ADX ${adx.toFixed(0)} — tendance forte, bon terrain pour un breakout qui continue`);
  } else if (adx > 20) {
    points += 3; details.push(`~ ADX ${adx.toFixed(0)} — tendance modérée`);
  } else {
    points += 0; details.push(`✗ ADX ${adx.toFixed(0)} — marché en range, risque de retournement`);
  }

  const volumeToUse = persistence ? persistence.relativeVolumeSinceBreakout : relativeVolume;
  if (volumeToUse > 2) {
    points += 4; details.push(`✓ Volume ${volumeToUse.toFixed(1)}× la normale depuis la cassure — forte conviction`);
  } else if (volumeToUse > 1.2) {
    points += 2; details.push(`~ Volume ${volumeToUse.toFixed(1)}× la normale depuis la cassure — correct`);
  } else {
    points += 0; details.push(`✗ Volume ${volumeToUse.toFixed(1)}× la normale depuis la cassure — participation faible`);
  }

  if (persistence) {
    if (persistence.priorFakeouts === 0) {
      points += 4; details.push(`✓ Premier test de ce niveau dans la session — pas de tentative ratée avant`);
    } else if (persistence.priorFakeouts === 1) {
      points += 2; details.push(`⚠ 1 tentative ratée sur ce niveau plus tôt dans la session — niveau déjà "testé"`);
    } else {
      points += 0; details.push(`✗ ${persistence.priorFakeouts} tentatives ratées sur ce niveau avant celle-ci — niveau probablement épuisé`);
    }
  } else {
    points += 2;
  }

  if (persistence && persistence.structureType === 'accumulation') {
    points += 4; details.push(`✓ Accumulation progressive avant la cassure — mouvement construit, pas un spike isolé`);
  } else if (persistence && persistence.structureType === 'spike') {
    points += 1; details.push(`⚠ Cassure en spike soudain, sans accumulation progressive avant — plus sujet à un retour rapide`);
  } else {
    points += 2;
  }

  const pct = points / maxPoints;
  let grade;
  if (pct >= 0.9) grade = 'S';
  else if (pct >= 0.75) grade = 'A';
  else if (pct >= 0.6) grade = 'B';
  else if (pct >= 0.4) grade = 'C';
  else if (pct >= 0.2) grade = 'D';
  else grade = 'E';

  if (notYetConfirmedByTime) {
    const gradeOrder = ['S', 'A', 'B', 'C', 'D', 'E'];
    if (gradeOrder.indexOf(grade) < gradeOrder.indexOf('B')) grade = 'B';
  }
  if (isNeutral) {
    const gradeOrder = ['S', 'A', 'B', 'C', 'D', 'E'];
    if (gradeOrder.indexOf(grade) < gradeOrder.indexOf('B')) grade = 'B';
  }

  return { grade, points, maxPoints, details, isNeutral, isLong, persistence, notYetConfirmedByTime };
}

function computeIndicators(data, orbMinutes) {
  const { timestamps, opens, highs, lows, closes, volumes } = data;
  const days = groupByTradingDay(timestamps);
  const lastDayKey = Object.keys(days).sort().pop();
  const lastDayIdx = days[lastDayKey];

  const candlesPerOrb = Math.max(1, Math.round(orbMinutes / 5));
  const orbIdx = lastDayIdx.slice(0, candlesPerOrb);
  const orbHigh = Math.max(...orbIdx.map(i => highs[i]));
  const orbLow = Math.min(...orbIdx.map(i => lows[i]));

  const CANDLE_INTERVAL_SEC = 5 * 60;
  const nowSec = Date.now() / 1000;
  const liveIdx = lastDayIdx[lastDayIdx.length - 1];
  const isLiveCandleOpen = (nowSec - timestamps[liveIdx]) < CANDLE_INTERVAL_SEC;
  const lastIdx = (isLiveCandleOpen && lastDayIdx.length > 1) ? lastDayIdx[lastDayIdx.length - 2] : liveIdx;

  const lastClose = closes[lastIdx];
  const livePrice = closes[liveIdx];
  const prevClose = closes[lastDayIdx[0]] ?? closes[0];

  let cumPV = 0, cumVol = 0;
  const vwapSeries = [];
  for (const i of lastDayIdx) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += typicalPrice * volumes[i];
    cumVol += volumes[i];
    vwapSeries.push(cumVol > 0 ? cumPV / cumVol : typicalPrice);
  }
  const currentVwap = vwapSeries[vwapSeries.length - 1];

  const atr = computeATR(highs, lows, closes, 14);
  const adx = computeADX(highs, lows, closes, 14);

  const orbVolume = orbIdx.reduce((s, i) => s + volumes[i], 0);
  const avgVolumePerCandle = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  const expectedOrbVolume = avgVolumePerCandle * candlesPerOrb;
  const relativeVolume = expectedOrbVolume > 0 ? orbVolume / expectedOrbVolume : 1;

  const priceAboveVwap = lastClose > currentVwap;
  const brokeHigh = lastClose > orbHigh;
  const brokeLow = lastClose < orbLow;
  const strongAdx = adx > 20;
  const strongVolume = relativeVolume > 1.2;

  let signal = 'neutral';
  let reasons = [];

  if (brokeHigh) {
    if (priceAboveVwap) reasons.push('prix au-dessus du VWAP'); else reasons.push('⚠ prix sous le VWAP malgré le breakout');
    if (strongAdx) reasons.push(`ADX ${adx.toFixed(0)} confirme la tendance`); else reasons.push(`⚠ ADX ${adx.toFixed(0)} faible, tendance peu franche`);
    if (strongVolume) reasons.push(`volume ${relativeVolume.toFixed(1)}x la normale`); else reasons.push('⚠ volume insuffisant sur le breakout');
    signal = (priceAboveVwap && strongAdx && strongVolume) ? 'bull' : 'neutral';
  } else if (brokeLow) {
    if (!priceAboveVwap) reasons.push('prix sous le VWAP'); else reasons.push('⚠ prix au-dessus du VWAP malgré le breakdown');
    if (strongAdx) reasons.push(`ADX ${adx.toFixed(0)} confirme la tendance`); else reasons.push(`⚠ ADX ${adx.toFixed(0)} faible, tendance peu franche`);
    if (strongVolume) reasons.push(`volume ${relativeVolume.toFixed(1)}x la normale`); else reasons.push('⚠ volume insuffisant sur le breakdown');
    signal = (!priceAboveVwap && strongAdx && strongVolume) ? 'bear' : 'neutral';
  } else {
    reasons.push('prix encore dans le range d\'ouverture, pas de breakout');
  }

  let persistence = null;
  if (signal === 'bull' || signal === 'bear') {
    const isLong = signal === 'bull';
    const level = isLong ? orbHigh : orbLow;
    const postOrbClosedIdx = lastDayIdx.filter(i => i > orbIdx[orbIdx.length - 1] && i <= lastIdx);
    const breakoutPointIdx = postOrbClosedIdx.find(i => isLong ? closes[i] > level : closes[i] < level);

    if (breakoutPointIdx != null) {
      const candlesSinceBreakout = postOrbClosedIdx.filter(i => i >= breakoutPointIdx);
      const minutesSinceBreakout = (candlesSinceBreakout.length - 1) * 5;
      const hasReturnedInsideRange = candlesSinceBreakout.some(i => isLong ? closes[i] <= level : closes[i] >= level);
      const volumeSinceBreakout = candlesSinceBreakout.reduce((s, i) => s + volumes[i], 0);
      const expectedVolumeSinceBreakout = avgVolumePerCandle * candlesSinceBreakout.length;
      const relativeVolumeSinceBreakout = expectedVolumeSinceBreakout > 0 ? volumeSinceBreakout / expectedVolumeSinceBreakout : 1;

      const candlesBeforeBreakout = postOrbClosedIdx.filter(i => i < breakoutPointIdx);
      let priorFakeouts = 0;
      let wasOutsideRange = false;
      for (const i of candlesBeforeBreakout) {
        const isOutsideNow = isLong ? closes[i] > level : closes[i] < level;
        if (isOutsideNow && !wasOutsideRange) { wasOutsideRange = true; }
        else if (!isOutsideNow && wasOutsideRange) { priorFakeouts++; wasOutsideRange = false; }
      }

      const lookback = 3;
      const preBreakoutIdx = postOrbClosedIdx.filter(i => i < breakoutPointIdx).slice(-lookback);
      let structureType = 'insufficient_data';
      if (preBreakoutIdx.length >= 2) {
        const relevantPrices = isLong ? preBreakoutIdx.map(i => highs[i]) : preBreakoutIdx.map(i => lows[i]);
        let isProgressive = true;
        for (let k = 1; k < relevantPrices.length; k++) {
          const gettingCloser = isLong ? relevantPrices[k] >= relevantPrices[k - 1] : relevantPrices[k] <= relevantPrices[k - 1];
          if (!gettingCloser) { isProgressive = false; break; }
        }
        structureType = isProgressive ? 'accumulation' : 'spike';
      }

      persistence = { minutesSinceBreakout, candlesHeld: candlesSinceBreakout.length, hasReturnedInsideRange, relativeVolumeSinceBreakout, priorFakeouts, structureType };

      if (hasReturnedInsideRange) {
        signal = 'neutral';
        reasons = ['⚠ Fakeout détecté — le prix est repassé dans le range ORB après avoir cassé, signal invalidé'];
      }
    }
  }

  const RR_RATIO = 2;
  const MAX_STOP_ATR_MULT = 1.5;
  const orbRange = orbHigh - orbLow;
  const maxStopDistance = atr * MAX_STOP_ATR_MULT;

  const longEntry = orbHigh;
  const longStopDistance = Math.min(orbRange, maxStopDistance);
  const longStop = longEntry - longStopDistance;
  const longTarget = longEntry + longStopDistance * RR_RATIO;
  const longStopCapped = longStopDistance < orbRange;

  const shortEntry = orbLow;
  const shortStopDistance = Math.min(orbRange, maxStopDistance);
  const shortStop = shortEntry + shortStopDistance;
  const shortTarget = shortEntry - shortStopDistance * RR_RATIO;
  const shortStopCapped = shortStopDistance < orbRange;

  const tradeLevels = {
    long: { entry: longEntry, stop: longStop, target: longTarget, stopCapped: longStopCapped, rr: RR_RATIO },
    short: { entry: shortEntry, stop: shortStop, target: shortTarget, stopCapped: shortStopCapped, rr: RR_RATIO },
  };

  const setupScore = computeSetupScore({ signal, lastClose, orbHigh, orbLow, orbRange, atr, adx, relativeVolume, priceAboveVwap, persistence });

  return { orbHigh, orbLow, orbVolume, candlesPerOrb, lastClose, prevClose, currentVwap, vwapSeries, livePrice, isLiveCandleOpen, atr, adx, relativeVolume, signal, reasons, lastDayIdx, tradeLevels, setupScore };
}

const HISTORY_KEY = 'orb-scanner-history';
const HISTORY_MAX_ENTRIES = 500;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.map(migrateHistoryEntry).filter(Boolean);
  } catch { return []; }
}

function migrateHistoryEntry(h) {
  if (!h || typeof h !== 'object') return null;
  if (h.id && h.direction && h.outcome) return h;
  const direction = h.direction || (h.signal === 'bull' ? 'long' : h.signal === 'bear' ? 'short' : null);
  if (!direction || typeof h.entry !== 'number' || typeof h.stop !== 'number' || typeof h.target !== 'number') return null;
  const outcomeMap = { win: 'win', loss: 'loss', pending: 'pending', breakeven: 'breakeven' };
  const outcome = outcomeMap[h.outcome] || outcomeMap[h._outcome] || 'pending';
  return {
    id: h.id || h.dedupeKey || `${h.ticker || 'UNKNOWN'}-${h.timestamp || Date.now()}`,
    ticker: h.ticker || '?', date: h.date || new Date().toISOString().slice(0, 10),
    timestamp: h.timestamp || Date.now(), direction, orbMinutes: h.orbMinutes || 15,
    entry: h.entry, stop: h.stop, target: h.target,
    positionValue: h.positionValue ?? null, shares: h.shares ?? null, outcome,
  };
}

function saveHistory(history) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {} }

function addTradeToHistory({ ticker, direction, entry, stop, target, positionValue, shares, orbMinutes, grade }) {
  const history = loadHistory();
  const today = new Date().toISOString().slice(0, 10);
  history.unshift({ id: `${ticker}-${Date.now()}`, ticker, date: today, timestamp: Date.now(), direction, orbMinutes, entry, stop, target, positionValue: positionValue ?? null, shares: shares ?? null, grade: grade || null, outcome: 'pending' });
  saveHistory(history.slice(0, HISTORY_MAX_ENTRIES));
}

function computeTradePnl(trade, outcome, exitPrice) {
  if (trade.shares == null) return null;
  const isLong = trade.direction === 'long';
  let exit;
  if (outcome === 'win') exit = trade.target;
  else if (outcome === 'loss') exit = trade.stop;
  else exit = exitPrice;
  if (exit == null || isNaN(exit)) return null;
  const pnl = isLong ? (exit - trade.entry) * trade.shares : (trade.entry - exit) * trade.shares;
  return { pnl, exit };
}

function updateTradeOutcome(id, outcome, exitPrice) {
  const history = loadHistory();
  const trade = history.find(h => h.id === id);
  if (!trade) return;
  trade.outcome = outcome;
  const result = computeTradePnl(trade, outcome, exitPrice);
  if (result) { trade.pnl = result.pnl; trade.exitPrice = result.exit; }
  else { trade.pnl = null; trade.exitPrice = null; }
  saveHistory(history);
}

function deleteTradeFromHistory(id) { saveHistory(loadHistory().filter(h => h.id !== id)); }

function renderHistoryPage() {
  const history = loadHistory();
  if (history.length === 0) {
    els.content.innerHTML = `${renderBackToScanIfNeeded()}<div class="empty-state"><div class="glyph">◷</div><p>Ton journal de suivi est vide. Depuis une carte Long ou Short, clique "+ Ajouter au suivi" pour enregistrer un trade que tu as réellement pris.</p></div>`;
    return;
  }
  const wins = history.filter(h => h.outcome === 'win').length;
  const losses = history.filter(h => h.outcome === 'loss').length;
  const breakeven = history.filter(h => h.outcome === 'breakeven').length;
  const pending = history.filter(h => h.outcome === 'pending').length;
  const resolved = wins + losses;
  const winrate = resolved > 0 ? ((wins / resolved) * 100).toFixed(0) : '—';
  const tradesWithPnl = history.filter(h => h.pnl != null);
  const totalPnl = tradesWithPnl.reduce((sum, h) => sum + h.pnl, 0);
  const pnlColor = totalPnl > 0 ? 'var(--bull)' : totalPnl < 0 ? 'var(--bear)' : 'var(--text-dim)';
  const grades = ['S', 'A', 'B', 'C', 'D', 'E'];
  const gradeStatsHtml = grades.map(g => {
    const tradesForGrade = history.filter(h => h.grade === g && (h.outcome === 'win' || h.outcome === 'loss'));
    if (tradesForGrade.length === 0) return null;
    const w = tradesForGrade.filter(h => h.outcome === 'win').length;
    const wr = ((w / tradesForGrade.length) * 100).toFixed(0);
    return `<span style="margin-right:14px;"><strong style="color:var(--text-bright);">${g}</strong>: ${wr}% (${tradesForGrade.length})</span>`;
  }).filter(Boolean).join('');

  const rows = history.map(h => {
    const outcomeMeta = { win: { label: 'Gagné', cls: 'tag-good' }, loss: { label: 'Perdu', cls: 'tag-bad' }, breakeven: { label: 'Clôturé manuel', cls: 'tag-warn' }, pending: { label: 'En cours', cls: 'tag-warn' } }[h.outcome];
    const dirLabel = h.direction === 'long' ? '▲ Long' : '▼ Short';
    const dirColor = h.direction === 'long' ? 'var(--bull)' : 'var(--bear)';
    const outcomeButtons = `<div style="display:flex; gap:4px; margin-top:4px;"><button class="outcome-btn" data-id="${h.id}" data-outcome="win" title="Marquer gagné" style="border-color:var(--bull); color:var(--bull);">✓</button><button class="outcome-btn" data-id="${h.id}" data-outcome="loss" title="Marquer perdu" style="border-color:var(--bear); color:var(--bear);">✗</button><button class="outcome-btn" data-id="${h.id}" data-outcome="breakeven" title="Clôturé manuellement" style="border-color:var(--warn); color:var(--warn);">=</button><button class="outcome-btn" data-id="${h.id}" data-delete="1" title="Supprimer" style="border-color:var(--text-dim); color:var(--text-dim);">🗑</button></div>`;
    const gradeColors = { S: 'var(--bull)', A: 'var(--bull)', B: 'var(--warn)', C: 'var(--warn)', D: 'var(--bear)', E: 'var(--bear)' };
    const gradeCell = h.grade ? `<span style="font-weight:700; color:${gradeColors[h.grade] || 'var(--text-dim)'}; font-family:var(--mono);">${h.grade}</span>` : '<span style="color:var(--text-dim);">—</span>';
    const pnlCell = h.pnl != null ? `<span style="color:${h.pnl >= 0 ? 'var(--bull)' : 'var(--bear)'}; font-weight:700;">${h.pnl >= 0 ? '+' : ''}${h.pnl.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$</span>` : '<span style="color:var(--text-dim);">—</span>';
    return `<tr><td class="scan-ticker">${h.ticker}</td><td style="font-family:var(--sans); font-size:12px; color:var(--text-dim)">${h.date}</td><td style="color:${dirColor}; font-weight:600;">${dirLabel}</td><td>${gradeCell}</td><td>${h.entry.toFixed(2)}</td><td style="color:var(--bear)">${h.stop.toFixed(2)}</td><td style="color:var(--bull)">${h.target.toFixed(2)}</td><td>${h.positionValue != null ? h.positionValue.toLocaleString('fr-BE', { maximumFractionDigits: 2 }) + '$' : '—'}</td><td>${pnlCell}</td><td><span class="indicator-tag ${outcomeMeta.cls}">${outcomeMeta.label}</span>${outcomeButtons}</td></tr>`;
  }).join('');

  els.content.innerHTML = `
    ${renderBackToScanIfNeeded()}
    <div class="ticker-header">
      <div class="ticker-id" style="font-size:20px;">Journal de suivi</div>
      ${tradesWithPnl.length > 0 ? `<div class="ticker-price" style="color:${pnlColor}; font-size:22px;">${totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$</div>` : ''}
    </div>
    ${tradesWithPnl.length < history.filter(h => h.outcome !== 'pending').length ? `<div style="font-size:11px; color:var(--text-dim); font-family:var(--sans); margin-bottom:12px;">PnL calculé sur ${tradesWithPnl.length} trade${tradesWithPnl.length > 1 ? 's' : ''} résolu${tradesWithPnl.length > 1 ? 's' : ''} avec montant connu</div>` : ''}
    <div class="signal-banner signal-neutral" style="margin-bottom:20px;">
      <span>${history.length} trade${history.length > 1 ? 's' : ''} enregistré${history.length > 1 ? 's' : ''}</span>
      <span class="signal-detail">${wins} gagné${wins > 1 ? 's' : ''} · ${losses} perdu${losses > 1 ? 's' : ''} · ${breakeven} clôturé${breakeven > 1 ? 's' : ''} manuellement · ${pending} en cours${resolved > 0 ? ` · winrate: ${winrate}%` : ''}</span>
    </div>
    ${gradeStatsHtml ? `<div style="font-family:var(--mono); font-size:12px; color:var(--text-dim); margin-bottom:16px;">Winrate par grade : ${gradeStatsHtml}</div>` : ''}
    <table class="scan-table">
      <thead><tr><th>Ticker</th><th>Date</th><th>Direction</th><th>Grade</th><th>Entrée</th><th>Stop</th><th>Target</th><th>Montant</th><th>PnL</th><th>Résultat</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:16px;"><button class="back-to-scan" id="clear-history-btn">Effacer tout le journal</button></div>
  `;

  document.getElementById('clear-history-btn')?.addEventListener('click', () => {
    if (confirm('Effacer tout le journal de suivi ? Cette action est irréversible.')) { saveHistory([]); renderHistoryPage(); }
  });
  document.getElementById('back-to-scan-btn-hist')?.addEventListener('click', runScanAll);
  els.content.querySelectorAll('.outcome-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.delete) { deleteTradeFromHistory(btn.dataset.id); }
      else if (btn.dataset.outcome === 'breakeven') {
        const input = prompt('À quel prix as-tu clôturé ce trade ?');
        if (input === null) return;
        const exitPrice = parseFloat(input.replace(',', '.'));
        if (isNaN(exitPrice) || exitPrice <= 0) { alert('Prix invalide.'); return; }
        updateTradeOutcome(btn.dataset.id, 'breakeven', exitPrice);
      } else { updateTradeOutcome(btn.dataset.id, btn.dataset.outcome); }
      renderHistoryPage();
    });
  });
}

function renderBackToScanIfNeeded() {
  return watchlist.length > 0 ? `<button class="back-to-scan" id="back-to-scan-btn-hist">← Retour au scan (${watchlist.length} tickers)</button>` : '';
}

function groupByTradingDay(timestamps) {
  const groups = {};
  for (let i = 0; i < timestamps.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    const key = d.toISOString().slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  }
  return groups;
}

function computeATR(highs, lows, closes, period) {
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function computeADX(highs, lows, closes, period) {
  const len = highs.length;
  if (len < period * 2) return 0;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr, period) => {
    const out = [];
    let sum = arr.slice(0, period).reduce((s, v) => s + v, 0);
    out.push(sum);
    for (let i = period; i < arr.length; i++) { sum = sum - (sum / period) + arr[i]; out.push(sum); }
    return out;
  };
  const smoothTR = smooth(tr, period);
  const smoothPlusDM = smooth(plusDM, period);
  const smoothMinusDM = smooth(minusDM, period);
  const dx = [];
  for (let i = 0; i < smoothTR.length; i++) {
    const plusDI = 100 * (smoothPlusDM[i] / smoothTR[i]);
    const minusDI = 100 * (smoothMinusDM[i] / smoothTR[i]);
    const sum = plusDI + minusDI;
    dx.push(sum > 0 ? 100 * Math.abs(plusDI - minusDI) / sum : 0);
  }
  const adxSlice = dx.slice(-period);
  return adxSlice.reduce((s, v) => s + v, 0) / adxSlice.length;
}

function setLoading(ticker) {
  els.content.innerHTML = `<div class="loading-state"><span class="loading-dot"></span>Récupération des données pour ${ticker}...</div>`;
}

function setError(ticker, message) {
  els.content.innerHTML = `<div class="error-state">Erreur sur ${ticker} : ${escapeHtml(message)}</div>`;
}

function renderResults(ticker, data, a, orbMinutes) {
  const change = a.lastClose - a.prevClose;
  const changePct = (change / a.prevClose) * 100;
  const isUp = change >= 0;
  const signalConfig = {
    bull: { icon: '▲', label: 'BREAKOUT HAUSSIER CONFIRMÉ', cls: 'signal-bull' },
    bear: { icon: '▼', label: 'BREAKOUT BAISSIER CONFIRMÉ', cls: 'signal-bear' },
    neutral: { icon: '—', label: 'PAS DE SIGNAL CONFIRMÉ', cls: 'signal-neutral' },
  }[a.signal];

  els.content.innerHTML = `
    ${watchlist.length > 0 ? `<button class="back-to-scan" id="back-to-scan-btn">← Retour au scan (${watchlist.length} tickers)</button>` : ''}
    <div class="ticker-header">
      <div style="display:flex; align-items:center; gap:14px;">
        <div class="ticker-id">${ticker}</div>
        <div class="ticker-price">${a.lastClose.toFixed(2)}</div>
        <div class="ticker-change ${isUp ? 'up-bg' : 'down-bg'}">${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePct.toFixed(2)}%)</div>
      </div>
    </div>
    <div class="signal-banner ${signalConfig.cls}">
      <span class="signal-icon">${signalConfig.icon}</span>
      <span>${signalConfig.label}</span>
      <span class="signal-detail">${a.reasons.join(' · ')}</span>
    </div>
    <div class="grid">
      <div class="chart-panel">
        <div id="chart-container"></div>
        <div class="chart-legend">
          <div class="legend-item"><span class="legend-swatch" style="background:#7B8FA6"></span>VWAP</div>
          <div class="legend-item"><span class="legend-swatch" style="background:#4A9B7F"></span>ORB High</div>
          <div class="legend-item"><span class="legend-swatch" style="background:#C4554A"></span>ORB Low</div>
        </div>
      </div>
      <div class="indicators-panel">
        ${renderIndicatorCard('ORB Range', `${a.orbLow.toFixed(2)} – ${a.orbHigh.toFixed(2)}`, '', `sur les ${orbMinutes} premières min`, null)}
        ${renderIndicatorCard('VWAP', a.currentVwap.toFixed(2), '', a.lastClose > a.currentVwap ? 'Prix au-dessus (biais haussier)' : 'Prix en-dessous (biais baissier)', a.lastClose > a.currentVwap ? 'good' : 'bad')}
        ${renderIndicatorCard('ATR (14)', a.atr.toFixed(2), '', `~${((a.atr / a.lastClose) * 100).toFixed(2)}% du prix — volatilité ${a.atr / a.lastClose > 0.005 ? 'normale' : 'faible'}`, a.atr / a.lastClose > 0.005 ? 'good' : 'warn')}
        ${renderIndicatorCard('ADX (14)', a.adx.toFixed(1), '', a.adx > 25 ? 'Tendance forte' : a.adx > 20 ? 'Tendance modérée' : 'Marché en range — prudence', a.adx > 20 ? 'good' : 'warn')}
        ${renderIndicatorCard('Volume relatif', `${a.relativeVolume.toFixed(2)}x`, '', a.relativeVolume > 1.2 ? 'Volume élevé — signal fiable' : 'Volume faible — risque de fakeout', a.relativeVolume > 1.2 ? 'good' : 'bad')}
      </div>
    </div>
    ${renderSetupScore(a)}
    ${renderTradeLevels(a, ticker, orbMinutes)}
  `;

  renderChart(data, a);

  document.getElementById('back-to-scan-btn')?.addEventListener('click', () => { runScanAll(); });

  els.content.querySelectorAll('.add-to-history-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      addTradeToHistory({
        ticker: btn.dataset.ticker, direction: btn.dataset.direction,
        entry: parseFloat(btn.dataset.entry), stop: parseFloat(btn.dataset.stop), target: parseFloat(btn.dataset.target),
        positionValue: btn.dataset.position ? parseFloat(btn.dataset.position) : null,
        shares: btn.dataset.shares ? parseFloat(btn.dataset.shares) : null,
        orbMinutes: parseInt(btn.dataset.orb, 10), grade: btn.dataset.grade,
      });
      btn.textContent = '✓ Ajouté au suivi';
      btn.disabled = true;
    });
  });
}

function renderSetupScore(a) {
  const s = a.setupScore;
  const gradeColors = { S: 'var(--bull)', A: 'var(--bull)', B: 'var(--warn)', C: 'var(--warn)', D: 'var(--bear)', E: 'var(--bear)' };
  const gradeVerdict = {
    S: 'Setup excellent — ordre limite proche du niveau a du sens',
    A: 'Bon setup — ordre limite raisonnable',
    B: s.isNeutral ? 'En approche — surveille, mais pas encore de breakout confirmé' : 'Setup correct mais avec réserves — regarde les détails',
    C: 'Setup moyen — sois prudent', D: 'Setup faible — probablement à éviter', E: 'Setup très faible — à éviter',
  };
  const color = gradeColors[s.grade];
  const cardTitle = s.isNeutral ? `Score indicatif — pas encore de breakout confirmé (côté ${s.isLong ? 'ORB High' : 'ORB Low'})` : 'Qualité de setup (ordre limite) — breakout confirmé';
  const detailsHtml = s.details.map(d => `<div style="padding:4px 0; font-size:12px; color:var(--text);">${escapeHtml(d)}</div>`).join('');
  const persistenceBadge = (s.persistence && !s.isNeutral && !s.notYetConfirmedByTime) ? `<div style="font-size:11px; color:var(--vwap); font-family:var(--mono); margin-top:4px;">⏱ Niveau tenu depuis ${s.persistence.minutesSinceBreakout} min — le score se renforce si ça continue</div>` : '';
  const capBadge = (s.notYetConfirmedByTime && !s.isNeutral) ? `<div style="font-size:11px; color:var(--warn); font-family:var(--mono); margin-top:4px;">⏳ Grade plafonné à B — breakout trop récent, attends qu'il tienne au moins 10 min avant d'agir</div>` : '';
  return `<div class="indicator-card" style="margin-top:20px; border-color:${color}; ${s.isNeutral ? 'border-style:dashed;' : ''}"><div style="display:flex; align-items:center; gap:16px; margin-bottom:10px;"><div style="font-family:var(--mono); font-size:42px; font-weight:700; color:${color}; line-height:1;">${s.grade}</div><div><div class="indicator-label" style="margin-bottom:2px;">${cardTitle}</div><div style="font-size:13px; font-weight:600; color:var(--text-bright);">${gradeVerdict[s.grade]}</div><div style="font-size:11px; color:var(--text-dim); font-family:var(--mono); margin-top:2px;">${s.points}/${s.maxPoints} points — score de règles, pas une probabilité statistique</div>${persistenceBadge}${capBadge}</div></div>${detailsHtml}</div>`;
}

function renderTradeLevels(a, ticker, orbMinutes) {
  const { long, short } = a.tradeLevels;
  const isLongActive = a.signal === 'bull';
  const isShortActive = a.signal === 'bear';
  const riskLong = long.entry - long.stop;
  const rewardLong = long.target - long.entry;
  const riskShort = short.stop - short.entry;
  const rewardShort = short.entry - short.target;
  const sizingLong = computePositionSize(long.entry, long.stop);
  const sizingShort = computePositionSize(short.entry, short.stop);

  const renderSizingRow = (sizing) => {
    if (!sizing) return `<div class="position-size-row"><span class="label">Montant à investir</span><span class="value" style="color:var(--text-dim); font-weight:400;">renseigne ta balance ci-dessus</span></div>`;
    if (sizing.balanceCapped) {
      const actualRiskPct = (sizing.riskAmount / userBalance) * 100;
      return `<div class="position-size-row" style="flex-direction:column; align-items:stretch; gap:4px;"><div style="display:flex; justify-content:space-between;"><span class="label">Montant à investir</span><span class="value">${sizing.positionValue.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$ <span style="color:var(--text-dim); font-weight:400; font-size:11px;">(= toute ta balance)</span></span></div><div style="font-size:11px; color:var(--warn); font-family:var(--sans);">⚠ Stop trop proche pour respecter ${riskPct}% avec cette balance — risque réel ~${actualRiskPct.toFixed(1)}% (${sizing.riskAmount.toFixed(2)}$) si tout le capital est engagé</div></div>`;
    }
    return `<div class="position-size-row"><span class="label">Montant à investir (${riskPct}% risqué)</span><span class="value">${sizing.positionValue.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$ <span style="color:var(--text-dim); font-weight:400; font-size:11px;">(${sizing.shares.toFixed(3)} actions · ~${sizing.riskAmount.toFixed(2)}$ risqués si SL touché)</span></span></div>`;
  };

  return `
    <div class="trade-levels">
      <div class="trade-card ${isLongActive ? 'active-long' : ''}">
        <div class="trade-card-header"><span class="trade-card-title long-title">▲ Long</span>${isLongActive ? '<span class="trade-active-badge">SIGNAL ACTIF</span>' : ''}</div>
        <div class="trade-row"><span class="trade-row-label">Entrée (ORB High)</span><span class="trade-row-value">${long.entry.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Stop-loss</span><span class="trade-row-value" style="color:var(--bear)">${long.stop.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Take-profit (${long.rr}:1)</span><span class="trade-row-value" style="color:var(--bull)">${long.target.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Risque / Reward</span><span class="trade-row-value">${riskLong.toFixed(2)} / ${rewardLong.toFixed(2)}</span></div>
        ${renderSizingRow(sizingLong)}
        <div class="trade-card-note">${long.stopCapped ? 'Stop plafonné à 1.5× ATR (range ORB plus large que la normale)' : 'Stop à l\'opposé exact du range ORB'}</div>
        <button class="add-to-history-btn" data-direction="long" data-ticker="${ticker}" data-orb="${orbMinutes}" data-entry="${long.entry}" data-stop="${long.stop}" data-target="${long.target}" data-position="${sizingLong ? sizingLong.positionValue : ''}" data-shares="${sizingLong ? sizingLong.shares : ''}" data-grade="${a.setupScore.grade}">+ Ajouter au suivi</button>
      </div>
      <div class="trade-card ${isShortActive ? 'active-short' : ''}">
        <div class="trade-card-header"><span class="trade-card-title short-title">▼ Short</span>${isShortActive ? '<span class="trade-active-badge">SIGNAL ACTIF</span>' : ''}</div>
        <div class="trade-row"><span class="trade-row-label">Entrée (ORB Low)</span><span class="trade-row-value">${short.entry.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Stop-loss</span><span class="trade-row-value" style="color:var(--bear)">${short.stop.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Take-profit (${short.rr}:1)</span><span class="trade-row-value" style="color:var(--bull)">${short.target.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Risque / Reward</span><span class="trade-row-value">${riskShort.toFixed(2)} / ${rewardShort.toFixed(2)}</span></div>
        ${renderSizingRow(sizingShort)}
        <div class="trade-card-note">${short.stopCapped ? 'Stop plafonné à 1.5× ATR (range ORB plus large que la normale)' : 'Stop à l\'opposé exact du range ORB'}</div>
        <button class="add-to-history-btn" data-direction="short" data-ticker="${ticker}" data-orb="${orbMinutes}" data-entry="${short.entry}" data-stop="${short.stop}" data-target="${short.target}" data-position="${sizingShort ? sizingShort.positionValue : ''}" data-shares="${sizingShort ? sizingShort.shares : ''}" data-grade="${a.setupScore.grade}">+ Ajouter au suivi</button>
      </div>
    </div>
  `;
}

function renderIndicatorCard(label, value, unit, subtext, tagType) {
  const tagClass = tagType === 'good' ? 'tag-good' : tagType === 'bad' ? 'tag-bad' : 'tag-warn';
  return `<div class="indicator-card"><div class="indicator-label">${label}</div><div class="indicator-value">${value}${unit ? `<span class="indicator-unit">${unit}</span>` : ''}</div>${tagType ? `<div class="indicator-tag ${tagClass}">${subtext}</div>` : `<div class="indicator-tag" style="background:var(--bg-panel-raised); color:var(--text-dim);">${subtext}</div>`}</div>`;
}

function renderChart(data, a) {
  const container = document.getElementById('chart-container');
  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML = `<div class="error-state">La librairie de graphique n'a pas pu se charger (CDN indisponible). Les indicateurs ci-contre restent valides — recharge la page dans quelques secondes.</div>`;
    return;
  }
  container.innerHTML = '';
  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth, height: 480,
    layout: { background: { color: 'transparent' }, textColor: '#6B6D73', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#1A1B1F' }, horzLines: { color: '#1A1B1F' } },
    rightPriceScale: { borderColor: '#24262B' },
    timeScale: { borderColor: '#24262B', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  candleSeries = chart.addCandlestickSeries({ upColor: '#4A9B7F', downColor: '#C4554A', borderUpColor: '#4A9B7F', borderDownColor: '#C4554A', wickUpColor: '#4A9B7F', wickDownColor: '#C4554A' });
  const candles = a.lastDayIdx.map(i => ({ time: data.timestamps[i], open: data.opens[i], high: data.highs[i], low: data.lows[i], close: data.closes[i] }));
  candleSeries.setData(candles);
  const vwapLine = chart.addLineSeries({ color: '#7B8FA6', lineWidth: 2, priceLineVisible: false });
  vwapLine.setData(a.lastDayIdx.map((i, idx) => ({ time: data.timestamps[i], value: a.vwapSeries[idx] })));
  candleSeries.createPriceLine({ price: a.orbHigh, color: '#4A9B7F', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'ORB High' });
  candleSeries.createPriceLine({ price: a.orbLow, color: '#C4554A', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'ORB Low' });
  chart.timeScale().fitContent();
  new ResizeObserver(entries => { if (entries.length === 0 || !chart) return; chart.applyOptions({ width: entries[0].contentRect.width }); }).observe(container);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
