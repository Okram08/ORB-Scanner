// ============================================================
// LONDON BREAKOUT — EUR/USD, day trading documenté
// Range asiatique (00h-08h GMT) -> breakout Londres (07h-12h GMT)
// ============================================================

const WORKER_URL = 'https://red-bush-d58eorbscanner.tom-vandendorpe.workers.dev/';
const TICKER = 'EURUSD=X';

const RR_RATIO = 2;
const MAX_STOP_ATR_MULT = 1.5;
const COMPRESSION_THRESHOLD = 0.35; // range asiatique < 35% de l'ATR14 = compression recherchée
const MIN_IMPULSE_BODY_RATIO = 0.5; // la bougie de cassure doit avoir un corps significatif, pas juste une mèche

const els = {
  scanBtn: document.getElementById('scan-btn'),
  resultsContainer: document.getElementById('results-container'),
  sessionStatusBar: document.getElementById('session-status-bar'),
  balanceBar: document.getElementById('balance-bar'),
};

els.scanBtn.addEventListener('click', runScan);

// ------------------------------------------------------------
// STATUT DE SESSION — informe si on est dans la fenêtre utile (7h-12h GMT)
// ------------------------------------------------------------
function getGmtTimeInfo() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'GMT', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const weekday = parts.find(p => p.type === 'weekday').value;
  return { totalMin: hour * 60 + minute, isWeekend: weekday === 'Sat' || weekday === 'Sun' };
}

function renderSessionStatus() {
  const { totalMin, isWeekend } = getGmtTimeInfo();
  const ASIAN_START = 0, ASIAN_END = 8 * 60, LONDON_START = 7 * 60, LONDON_END = 12 * 60;

  let html;
  if (isWeekend) {
    html = `<div class="session-status session-closed"><span class="dot"></span>Forex fermé (week-end)<span class="session-detail">Reprend dimanche soir / lundi matin GMT</span></div>`;
  } else if (totalMin < ASIAN_END) {
    const remaining = ASIAN_END - totalMin;
    html = `<div class="session-status session-forming"><span class="dot"></span>Range asiatique en formation<span class="session-detail">Se termine dans ${Math.floor(remaining/60)}h${String(remaining%60).padStart(2,'0')} (08h00 GMT) — pas encore de signal possible</span></div>`;
  } else if (totalMin >= LONDON_START && totalMin <= LONDON_END) {
    const remaining = LONDON_END - totalMin;
    html = `<div class="session-status session-active"><span class="dot"></span>Fenêtre Londres active — ${Math.floor(remaining/60)}h${String(remaining%60).padStart(2,'0')} restantes<span class="session-detail">C'est le moment d'analyser</span></div>`;
  } else if (totalMin > LONDON_END) {
    html = `<div class="session-status session-closed"><span class="dot"></span>Fenêtre Londres fermée pour aujourd'hui<span class="session-detail">L'edge du breakout matinal s'estompe après 12h GMT</span></div>`;
  } else {
    html = `<div class="session-status session-forming"><span class="dot"></span>Range formé, en attente de l'ouverture de Londres (07h GMT)<span class="session-detail"></span></div>`;
  }
  els.sessionStatusBar.innerHTML = html;
}

renderSessionStatus();
setInterval(renderSessionStatus, 60000);

// ------------------------------------------------------------
// BALANCE & RISQUE — même mécanisme que les autres outils
// ------------------------------------------------------------
const BALANCE_KEY = 'london-breakout-balance';
const RISK_PCT_KEY = 'london-breakout-risk-pct';
const DEFAULT_RISK_PCT = 1;

function loadBalance() { try { const r = localStorage.getItem(BALANCE_KEY); return r ? parseFloat(r) : null; } catch { return null; } }
function saveBalance(v) { try { localStorage.setItem(BALANCE_KEY, String(v)); } catch {} }
function loadRiskPct() { try { const r = localStorage.getItem(RISK_PCT_KEY); return r ? parseFloat(r) : DEFAULT_RISK_PCT; } catch { return DEFAULT_RISK_PCT; } }
function saveRiskPct(v) { try { localStorage.setItem(RISK_PCT_KEY, String(v)); } catch {} }

let userBalance = loadBalance();
let riskPct = loadRiskPct();
let currentAnalysis = null;

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
      <span class="risk-pct">Risque par trade :</span>
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
  if (currentAnalysis) renderAll(currentAnalysis);
}

function promptEditRiskPct() {
  const input = prompt('Pourcentage de la balance à risquer par trade (%) :', riskPct);
  if (input === null) return;
  const value = parseFloat(input.replace(',', '.'));
  if (isNaN(value) || value <= 0 || value > 100) { alert('Pourcentage invalide.'); return; }
  riskPct = value; saveRiskPct(value); renderBalanceBar();
  if (currentAnalysis) renderAll(currentAnalysis);
}

renderBalanceBar();

function computePositionSize(entry, stop) {
  if (userBalance === null) return null;
  const riskAmount = userBalance * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  if (stopDistance <= 0) return null;
  let units = riskAmount / stopDistance;
  let positionValue = units * entry;
  const balanceCapped = positionValue > userBalance;
  if (balanceCapped) { positionValue = userBalance; units = positionValue / entry; }
  const actualRiskAmount = units * stopDistance;
  return { units, riskAmount: actualRiskAmount, positionValue, balanceCapped };
}

// ------------------------------------------------------------
// FETCH
// ------------------------------------------------------------
async function fetchHourlyData() {
  const url = `${WORKER_URL}?ticker=${encodeURIComponent(TICKER)}&interval=60m&range=30d`;
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
  const out = { timestamps: [], opens: [], highs: [], lows: [], closes: [] };
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue;
    out.timestamps.push(timestamps[i]);
    out.opens.push(quote.open[i]);
    out.highs.push(quote.high[i]);
    out.lows.push(quote.low[i]);
    out.closes.push(quote.close[i]);
  }
  return out;
}

// ------------------------------------------------------------
// ORCHESTRATION
// ------------------------------------------------------------
async function runScan() {
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = 'Analyse en cours...';
  els.resultsContainer.innerHTML = `<div class="empty-state"><div class="glyph">◐</div><p>Récupération des données EUR/USD...</p></div>`;

  try {
    const raw = await fetchHourlyData();
    const parsed = parseYahooResponse(raw);
    if (!parsed || parsed.closes.length < 100) {
      throw new Error('Pas assez de données horaires reçues.');
    }
    currentAnalysis = analyzeLondonBreakout(parsed);
    renderAll(currentAnalysis);
  } catch (e) {
    els.resultsContainer.innerHTML = `<div class="error-state">Erreur : ${escapeHtml(e.message)}</div>`;
  } finally {
    els.scanBtn.disabled = false;
    els.scanBtn.textContent = 'Analyser EUR/USD';
  }
}

// ------------------------------------------------------------
// ANALYSE — logique London Breakout
// ------------------------------------------------------------
function analyzeLondonBreakout(data) {
  const { timestamps, opens, highs, lows, closes } = data;
  const n = closes.length;

  // Regroupe les bougies par jour calendaire GMT
  const dayGroups = {};
  for (let i = 0; i < n; i++) {
    const d = new Date(timestamps[i] * 1000);
    const key = d.toISOString().slice(0, 10);
    if (!dayGroups[key]) dayGroups[key] = [];
    dayGroups[key].push(i);
  }
  const dayKeys = Object.keys(dayGroups).sort();
  const lastDayKey = dayKeys[dayKeys.length - 1];
  const todayIdx = dayGroups[lastDayKey];

  // Sépare les bougies de la session asiatique (heures GMT 0-6, avant l'ouverture de Londres)
  // et celles depuis Londres (7h+). Pas de chevauchement : la bougie de 7h est le premier
  // point de mesure du breakout, elle ne doit jamais contribuer au range asiatique lui-même.
  const asianIdx = todayIdx.filter(i => {
    const h = new Date(timestamps[i] * 1000).getUTCHours();
    return h >= 0 && h < 7;
  });
  const londonIdx = todayIdx.filter(i => {
    const h = new Date(timestamps[i] * 1000).getUTCHours();
    return h >= 7;
  });

  const atr = computeDailyATR(timestamps, highs, lows, closes, 14);

  let signal = 'none';
  const details = [];
  let asianHigh = null, asianLow = null, asianRange = null, isCompressed = false;

  if (asianIdx.length < 4) {
    details.push({ icon: 'neutral', text: `Pas assez de bougies asiatiques disponibles pour ce jour (${asianIdx.length}) — réessaie plus tard dans la session` });
  } else {
    asianHigh = Math.max(...asianIdx.map(i => highs[i]));
    asianLow = Math.min(...asianIdx.map(i => lows[i]));
    asianRange = asianHigh - asianLow;
    const compressionRatio = atr > 0 ? asianRange / atr : 1;
    isCompressed = compressionRatio < COMPRESSION_THRESHOLD;

    if (isCompressed) {
      details.push({ icon: 'good', text: `Range asiatique compressé : ${(compressionRatio * 100).toFixed(0)}% de l'ATR14 (seuil : ${(COMPRESSION_THRESHOLD*100).toFixed(0)}%) — bon terrain pour un breakout explosif` });
    } else {
      details.push({ icon: 'warn', text: `Range asiatique pas assez compressé : ${(compressionRatio * 100).toFixed(0)}% de l'ATR14 — l'edge de compression/expansion est moins net` });
    }

    if (londonIdx.length === 0) {
      details.push({ icon: 'neutral', text: `Session de Londres pas encore commencée` });
    } else {
      // Cherche la première bougie CLOSE de la session Londres qui a cassé le range, avec clôture hors range
      const breakoutIdx = londonIdx.find(i => closes[i] > asianHigh || closes[i] < asianLow);

      if (breakoutIdx == null) {
        details.push({ icon: 'neutral', text: `Prix encore dans le range asiatique (${asianLow.toFixed(5)} – ${asianHigh.toFixed(5)}) — pas de cassure` });
      } else {
        const isLong = closes[breakoutIdx] > asianHigh;
        const level = isLong ? asianHigh : asianLow;

        // Anti-fakeout : la bougie de cassure doit avoir un corps significatif (impulsion),
        // pas juste une mèche qui dépasse puis revient
        const body = Math.abs(closes[breakoutIdx] - opens[breakoutIdx]);
        const range = highs[breakoutIdx] - lows[breakoutIdx];
        const hasImpulse = range > 0 && (body / range) >= MIN_IMPULSE_BODY_RATIO;

        // Persistance : vérifie que les bougies closes depuis la cassure sont restées du bon côté
        const postBreakoutIdx = londonIdx.filter(i => i >= breakoutIdx);
        const hasReturnedInsideRange = postBreakoutIdx.some(i => isLong ? closes[i] <= level : closes[i] >= level);

        const adx = computeADX(highs, lows, closes, 14);

        if (hasReturnedInsideRange) {
          details.push({ icon: 'bad', text: `⚠ Fakeout détecté — le prix est repassé dans le range asiatique après avoir cassé` });
        } else if (!hasImpulse) {
          details.push({ icon: 'warn', text: `Cassure détectée mais bougie sans impulsion nette (corps ${(body/range*100).toFixed(0)}% du range) — risque de fakeout, prudence` });
        } else {
          signal = isLong ? 'long' : 'short';
          details.push({ icon: 'good', text: `Cassure ${isLong ? 'haussière' : 'baissière'} confirmée par clôture hors range, avec impulsion nette (corps ${(body/range*100).toFixed(0)}% du range)` });
        }

        details.push({ icon: adx > 20 ? 'good' : 'warn', text: `ADX ${adx.toFixed(0)} — ${adx > 25 ? 'tendance bien établie' : adx > 20 ? 'tendance modérée' : 'tendance faible, prudence accrue'}` });

        if (signal !== 'none' && !isCompressed) {
          details.push({ icon: 'warn', text: `Signal présent mais range asiatique non compressé — edge moins documenté dans ce contexte` });
        }
      }
    }
  }

  const lastClose = closes[n - 1];

  // --- Niveaux de trade ---
  let levels = null;
  if (signal !== 'none' && asianRange != null) {
    const isLong = signal === 'long';
    const entry = isLong ? asianHigh : asianLow;
    const stopDistance = Math.min(asianRange, atr * MAX_STOP_ATR_MULT);
    const stop = isLong ? entry - stopDistance : entry + stopDistance;
    const target = isLong ? entry + stopDistance * RR_RATIO : entry - stopDistance * RR_RATIO;
    levels = { entry, stop, target, stopDistance, rr: RR_RATIO };
  }

  return { lastClose, asianHigh, asianLow, asianRange, isCompressed, atr, signal, details, levels, data, todayIdx, asianIdx };
}

// Calcule un ATR journalier (14 jours) à partir de bougies horaires, en agrégeant
// d'abord chaque jour calendaire GMT en une bougie OHLC journalière.
function computeDailyATR(timestamps, highs, lows, closes, period = 14) {
  const days = {};
  for (let i = 0; i < timestamps.length; i++) {
    const key = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (!days[key]) days[key] = { high: highs[i], low: lows[i], close: closes[i] };
    else {
      days[key].high = Math.max(days[key].high, highs[i]);
      days[key].low = Math.min(days[key].low, lows[i]);
      days[key].close = closes[i]; // dernière clôture rencontrée pour ce jour
    }
  }
  const dayKeys = Object.keys(days).sort();
  const dHighs = dayKeys.map(k => days[k].high);
  const dLows = dayKeys.map(k => days[k].low);
  const dCloses = dayKeys.map(k => days[k].close);

  const trs = [];
  for (let i = 1; i < dHighs.length; i++) {
    trs.push(Math.max(dHighs[i] - dLows[i], Math.abs(dHighs[i] - dCloses[i - 1]), Math.abs(dLows[i] - dCloses[i - 1])));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : (dHighs[dHighs.length-1] - dLows[dLows.length-1]) || 0.001;
}

function computeADX(highs, lows, closes, period) {
  const len = highs.length;
  if (len < period * 2) return 15;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr, p) => {
    const out = []; let sum = arr.slice(0, p).reduce((s, v) => s + v, 0); out.push(sum);
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
  return adxSlice.length ? adxSlice.reduce((s, v) => s + v, 0) / adxSlice.length : 15;
}

// ------------------------------------------------------------
// RENDU
// ------------------------------------------------------------
function renderAll(a) {
  renderSignal(a);
  renderChart(a);
  renderTradeLevels(a);
}

function renderSignal(a) {
  const stateClass = { long: 'state-long', short: 'state-short', none: 'state-none' }[a.signal];
  const verdictText = { long: '▲ BREAKOUT HAUSSIER CONFIRMÉ', short: '▼ BREAKOUT BAISSIER CONFIRMÉ', none: '— PAS DE SIGNAL CONFIRMÉ' }[a.signal];

  const detailsHtml = a.details.map(d => `
    <div class="reasoning-row">
      <span class="reasoning-icon icon-${d.icon}">${{ good: '✓', bad: '✗', warn: '~', neutral: 'ℹ' }[d.icon]}</span>
      <span>${escapeHtml(d.text)}</span>
    </div>
  `).join('');

  els.resultsContainer.innerHTML = `
    <div class="signal-hero state-${a.signal}">
      <div class="signal-hero-label">Signal EUR/USD — London Breakout</div>
      <div class="signal-hero-verdict">${verdictText}</div>
      <div class="signal-hero-detail">Basé sur la compression du range asiatique et la qualité de la cassure à l'ouverture de Londres.</div>
    </div>

    <div class="grid-2">
      <div class="metric-card">
        <div class="metric-label">Prix actuel</div>
        <div class="metric-value">${a.lastClose.toFixed(5)}</div>
        <div class="metric-sub">${a.asianHigh != null ? `Range asiatique : ${a.asianLow.toFixed(5)} – ${a.asianHigh.toFixed(5)}` : 'Range asiatique pas encore disponible'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Compression du range</div>
        <div class="metric-value" style="color:${a.isCompressed ? 'var(--bull)' : 'var(--warn)'}">${a.isCompressed ? 'Oui' : 'Non'}</div>
        <div class="metric-sub">${a.asianRange != null ? `Range : ${(a.asianRange).toFixed(5)} · ATR14 : ${a.atr.toFixed(5)}` : ''}</div>
      </div>
    </div>

    <div class="reasoning-panel">
      <div class="reasoning-title">Raisonnement complet</div>
      ${detailsHtml}
    </div>

    <div id="chart-container"></div>
  `;
}

function renderTradeLevels(a) {
  if (!a.levels) return;

  const sizing = computePositionSize(a.levels.entry, a.levels.stop);
  const sizingHtml = renderSizingBlock(sizing);

  const panel = document.createElement('div');
  panel.className = 'trade-levels-panel';
  panel.innerHTML = `
    <div class="reasoning-title">Niveaux de trade (${a.signal === 'long' ? 'Long' : 'Short'})</div>
    <div class="trade-row"><span class="trade-row-label">Entrée</span><span>${a.levels.entry.toFixed(5)}</span></div>
    <div class="trade-row"><span class="trade-row-label">Stop-loss</span><span style="color:var(--bear)">${a.levels.stop.toFixed(5)}</span></div>
    <div class="trade-row"><span class="trade-row-label">Take-profit (${a.levels.rr}:1)</span><span style="color:var(--bull)">${a.levels.target.toFixed(5)}</span></div>
    ${sizingHtml}
    <div class="reasoning-row" style="border-bottom:none; font-size:11px; color:var(--text-dim);">Clôture manuelle recommandée si ni TP ni SL touché après 24h — l'edge du breakout matinal ne justifie pas de garder la position au-delà.</div>
  `;

  const chartContainer = document.getElementById('chart-container');
  chartContainer.parentElement.insertBefore(panel, chartContainer);
}

function renderSizingBlock(sizing) {
  if (!sizing) {
    return `<div class="position-size-row"><span class="label">Montant à investir</span><span class="value" style="color:var(--text-dim); font-weight:400;">renseigne ta balance en haut de page</span></div>`;
  }
  if (sizing.balanceCapped) {
    return `<div class="position-size-row"><span class="label">Montant à investir</span><span class="value" style="color:var(--warn);">= toute ta balance (stop trop large pour respecter ${riskPct}%)</span></div>`;
  }
  return `<div class="position-size-row"><span class="label">Montant à investir (${riskPct}% risqué)</span><span class="value">${sizing.positionValue.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$ <span style="color:var(--text-dim); font-weight:400; font-size:11px;">(~${sizing.riskAmount.toFixed(2)}$ risqués si SL touché)</span></span></div>`;
}

function renderChart(a) {
  const container = document.getElementById('chart-container');
  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML = '<div class="empty-state">Graphique indisponible.</div>';
    return;
  }
  container.innerHTML = '';

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

  const d = a.data;
  const recentIdx = a.todayIdx;
  candleSeries.setData(recentIdx.map(i => ({ time: d.timestamps[i], open: d.opens[i], high: d.highs[i], low: d.lows[i], close: d.closes[i] })));

  if (a.asianHigh != null) {
    candleSeries.createPriceLine({ price: a.asianHigh, color: '#4A9B7F', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Asian High' });
    candleSeries.createPriceLine({ price: a.asianLow, color: '#C4554A', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Asian Low' });
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
