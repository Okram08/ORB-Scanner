// ============================================================
// ORB BACKTEST — rejoue la logique ORB du scanner sur l'historique
// ============================================================

const WORKER_URL = 'https://red-bush-d58eorbscanner.tom-vandendorpe.workers.dev/';
const RR_RATIO = 2;
const MAX_STOP_ATR_MULT = 1.5;
const MIN_MINUTES_FOR_TOP_GRADE = 10;

const els = {
  tickersInput: document.getElementById('tickers-input'),
  dateFrom: document.getElementById('date-from'),
  dateTo: document.getElementById('date-to'),
  orbWindow: document.getElementById('orb-window-bt'),
  runBtn: document.getElementById('run-backtest-btn'),
  resultsContainer: document.getElementById('results-container'),
  progressContainer: document.getElementById('progress-bar-container'),
  progressFill: document.getElementById('progress-fill'),
  progressLabel: document.getElementById('progress-label'),
  requestEstimate: document.getElementById('request-estimate'),
};

// Dates par défaut : 90 derniers jours jusqu'à hier (StockData.org peut ne pas avoir
// aujourd'hui si le marché est encore ouvert / données pas finalisées)
(function setDefaultDates() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  els.dateTo.value = yesterday.toISOString().slice(0, 10);
  els.dateFrom.value = ninetyDaysAgo.toISOString().slice(0, 10);
  updateRequestEstimate();
})();

els.tickersInput.addEventListener('input', updateRequestEstimate);
els.dateFrom.addEventListener('change', updateRequestEstimate);
els.dateTo.addEventListener('change', updateRequestEstimate);

function updateRequestEstimate() {
  const tickers = parseTickers();
  const days = daysBetween(els.dateFrom.value, els.dateTo.value);
  const chunksPerTicker = Math.ceil(days / 7);
  const totalRequests = tickers.length * chunksPerTicker;
  els.requestEstimate.textContent = `${totalRequests} requête${totalRequests > 1 ? 's' : ''}`;
  els.requestEstimate.style.color = totalRequests > 100 ? 'var(--bear)' : 'var(--warn)';
}

function parseTickers() {
  return els.tickersInput.value.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  const d1 = new Date(from), d2 = new Date(to);
  return Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
}

els.runBtn.addEventListener('click', runBacktest);

// ------------------------------------------------------------
// ORCHESTRATION PRINCIPALE
// ------------------------------------------------------------
async function runBacktest() {
  const tickers = parseTickers();
  const dateFrom = els.dateFrom.value;
  const dateTo = els.dateTo.value;
  const orbMinutes = parseInt(els.orbWindow.value, 10);

  if (tickers.length === 0) { alert('Ajoute au moins un ticker.'); return; }
  if (!dateFrom || !dateTo) { alert('Renseigne une plage de dates.'); return; }

  els.runBtn.disabled = true;
  els.progressContainer.style.display = 'block';
  els.resultsContainer.innerHTML = '';

  const allTrades = [];
  const errors = [];

  // Découpe la plage totale en tranches de 7 jours (limite du plan gratuit StockData.org)
  const chunks = splitIntoWeeklyChunks(dateFrom, dateTo);
  const totalSteps = tickers.length * chunks.length;
  let stepsDone = 0;

  for (const ticker of tickers) {
    let allCandles = [];

    for (const chunk of chunks) {
      updateProgress(stepsDone, totalSteps, `Récupération ${ticker} (${chunk.from} → ${chunk.to})...`);
      try {
        const candles = await fetchStockDataChunk(ticker, chunk.from, chunk.to);
        allCandles = allCandles.concat(candles);
      } catch (e) {
        errors.push(`${ticker} (${chunk.from} → ${chunk.to}): ${e.message}`);
      }
      stepsDone++;
      updateProgress(stepsDone, totalSteps, `Récupération ${ticker}...`);
      await sleep(150); // petite pause pour rester sous la limite de requêtes/minute
    }

    if (allCandles.length === 0) continue;

    updateProgress(stepsDone, totalSteps, `Analyse de ${ticker}...`);
    const tradesForTicker = analyzeHistoricalData(ticker, allCandles, orbMinutes);
    allTrades.push(...tradesForTicker);
  }

  els.progressContainer.style.display = 'none';
  els.runBtn.disabled = false;

  renderBacktestResults(allTrades, errors, tickers, dateFrom, dateTo);
}

function updateProgress(done, total, label) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressLabel.textContent = `${label} (${done}/${total})`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function splitIntoWeeklyChunks(dateFrom, dateTo) {
  const chunks = [];
  let cursor = new Date(dateFrom);
  const end = new Date(dateTo);

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 6);
    const actualEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({ from: cursor.toISOString().slice(0, 10), to: actualEnd.toISOString().slice(0, 10) });
    cursor = new Date(actualEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

// ------------------------------------------------------------
// FETCH — StockData.org via le Worker Cloudflare (proxy + clé API secrète)
// ------------------------------------------------------------
async function fetchStockDataChunk(ticker, dateFrom, dateTo) {
  const proxyUrl = `${WORKER_URL}?source=stockdata&symbols=${encodeURIComponent(ticker)}&date_from=${dateFrom}&date_to=${dateTo}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!data.data) return [];

  // Format StockData.org -> format candle uniforme { timestamp, open, high, low, close, volume }
  return data.data
    .filter(d => d.ticker === ticker)
    .map(d => ({
      timestamp: Math.floor(new Date(d.date).getTime() / 1000),
      open: d.data.open, high: d.data.high, low: d.data.low, close: d.data.close, volume: d.data.volume,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ------------------------------------------------------------
// ANALYSE HISTORIQUE — rejoue la logique ORB jour par jour
// ------------------------------------------------------------
function analyzeHistoricalData(ticker, candles, orbMinutes) {
  const days = groupByTradingDay(candles);
  const dayKeys = Object.keys(days).sort();
  const trades = [];

  const candlesPerOrb = Math.max(1, Math.round(orbMinutes / 5));

  for (const dayKey of dayKeys) {
    const dayIdx = days[dayKey];
    if (dayIdx.length < candlesPerOrb + 3) continue; // pas assez de bougies ce jour-là

    const highs = dayIdx.map(i => candles[i].high);
    const lows = dayIdx.map(i => candles[i].low);
    const closes = dayIdx.map(i => candles[i].close);
    const volumes = dayIdx.map(i => candles[i].volume);

    const orbHigh = Math.max(...highs.slice(0, candlesPerOrb));
    const orbLow = Math.min(...lows.slice(0, candlesPerOrb));
    const orbRange = orbHigh - orbLow;

    const atr = computeATR(highs, lows, closes, Math.min(14, highs.length - 1));
    const adx = computeADX(highs, lows, closes, Math.min(14, Math.floor(highs.length / 2)));
    const avgVolumePerCandle = volumes.reduce((s, v) => s + v, 0) / volumes.length;

    // VWAP de la journée
    let cumPV = 0, cumVol = 0;
    const vwapByIdx = [];
    for (let k = 0; k < dayIdx.length; k++) {
      const tp = (highs[k] + lows[k] + closes[k]) / 3;
      cumPV += tp * volumes[k];
      cumVol += volumes[k];
      vwapByIdx.push(cumVol > 0 ? cumPV / cumVol : tp);
    }

    // Cherche un breakout haussier ET baissier distincts ce jour-là (comme le ferait
    // un utilisateur qui checke plusieurs fois entre 15h45 et 17h)
    for (const direction of ['long', 'short']) {
      const isLong = direction === 'long';
      const level = isLong ? orbHigh : orbLow;

      const postOrbIdx = [];
      for (let k = candlesPerOrb; k < dayIdx.length; k++) postOrbIdx.push(k);

      const breakoutK = postOrbIdx.find(k => isLong ? closes[k] > level : closes[k] < level);
      if (breakoutK == null) continue;

      // Compte les faux breakouts précédents sur ce niveau (avant ce breakout-ci)
      let priorFakeouts = 0;
      let wasOutside = false;
      for (const k of postOrbIdx) {
        if (k >= breakoutK) break;
        const outsideNow = isLong ? closes[k] > level : closes[k] < level;
        if (outsideNow && !wasOutside) wasOutside = true;
        else if (!outsideNow && wasOutside) { priorFakeouts++; wasOutside = false; }
      }

      // Structure pré-cassure (accumulation vs spike)
      const lookback = 3;
      const preIdx = postOrbIdx.filter(k => k < breakoutK).slice(-lookback);
      let structureType = 'insufficient_data';
      if (preIdx.length >= 2) {
        const rel = isLong ? preIdx.map(k => highs[k]) : preIdx.map(k => lows[k]);
        let progressive = true;
        for (let m = 1; m < rel.length; m++) {
          const closer = isLong ? rel[m] >= rel[m - 1] : rel[m] <= rel[m - 1];
          if (!closer) { progressive = false; break; }
        }
        structureType = progressive ? 'accumulation' : 'spike';
      }

      // Persistance : cherche jusqu'où le niveau tient (ou fakeout) après la cassure,
      // et détermine le moment où le grade "final" aurait été atteint (10 min de tenue)
      let hasReturnedInsideRange = false;
      let candlesHeld = 0;
      for (const k of postOrbIdx) {
        if (k < breakoutK) continue;
        candlesHeld++;
        const stillOutside = isLong ? closes[k] > level : closes[k] < level;
        if (!stillOutside) { hasReturnedInsideRange = true; break; }
      }

      if (hasReturnedInsideRange) continue; // fakeout — pas un signal valide, on ignore (cohérent avec le scanner)

      const minutesSinceBreakout = (candlesHeld - 1) * 5;
      const volumeSinceBreakoutIdx = postOrbIdx.filter(k => k >= breakoutK && k < breakoutK + candlesHeld);
      const volumeSinceBreakout = volumeSinceBreakoutIdx.reduce((s, k) => s + volumes[k], 0);
      const expectedVol = avgVolumePerCandle * volumeSinceBreakoutIdx.length;
      const relativeVolumeSinceBreakout = expectedVol > 0 ? volumeSinceBreakout / expectedVol : 1;

      const priceAboveVwap = closes[breakoutK] > vwapByIdx[breakoutK];
      const strongAdx = adx > 20;
      const strongVolume = relativeVolumeSinceBreakout > 1.2;
      const validSignal = isLong ? (priceAboveVwap && strongAdx && strongVolume) : (!priceAboveVwap && strongAdx && strongVolume);
      if (!validSignal) continue; // même filtre que le scanner en direct

      const persistence = { minutesSinceBreakout, hasReturnedInsideRange, relativeVolumeSinceBreakout, priorFakeouts, structureType };
      const setupScore = computeSetupScore({
        signal: isLong ? 'bull' : 'bear', orbRange, atr, adx, persistence,
      });

      // Niveaux de trade (identiques à la logique du scanner)
      const stopDistance = Math.min(orbRange, atr * MAX_STOP_ATR_MULT);
      const entry = level;
      const stop = isLong ? entry - stopDistance : entry + stopDistance;
      const target = isLong ? entry + stopDistance * RR_RATIO : entry - stopDistance * RR_RATIO;

      // Simule le résultat : cherche si TP ou SL est touché sur les bougies restantes du jour
      let outcome = 'pending'; // pas résolu avant la fin de la session (= clôture manuelle simulée)
      let exitPrice = closes[dayIdx.length - 1]; // clôture de la journée si rien n'est touché
      for (let k = breakoutK + candlesHeld; k < dayIdx.length; k++) {
        if (isLong) {
          if (lows[k] <= stop) { outcome = 'loss'; exitPrice = stop; break; }
          if (highs[k] >= target) { outcome = 'win'; exitPrice = target; break; }
        } else {
          if (highs[k] >= stop) { outcome = 'loss'; exitPrice = stop; break; }
          if (lows[k] <= target) { outcome = 'win'; exitPrice = target; break; }
        }
      }
      if (outcome === 'pending') outcome = 'closed_eod'; // clôturé à la fin de journée, ni TP ni SL

      const pnlPerShare = isLong ? (exitPrice - entry) : (entry - exitPrice);

      trades.push({
        ticker, date: dayKey, direction, grade: setupScore.grade,
        entry, stop, target, exitPrice, outcome, pnlPerShare,
        minutesSinceBreakout, priorFakeouts, structureType,
      });
    }
  }

  return trades;
}

function groupByTradingDay(candles) {
  const groups = {};
  for (let i = 0; i < candles.length; i++) {
    const key = new Date(candles[i].timestamp * 1000).toISOString().slice(0, 10);
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
  return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : (highs[highs.length - 1] - lows[lows.length - 1]) || 1;
}

function computeADX(highs, lows, closes, period) {
  const len = highs.length;
  if (len < period * 2 || period < 1) return 15; // valeur neutre si pas assez de données
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
  return adxSlice.length ? adxSlice.reduce((s, v) => s + v, 0) / adxSlice.length : 15;
}

// Version simplifiée du score (mêmes règles que app.js, sans le volet "neutre"
// puisqu'en backtest on n'enregistre que des breakouts confirmés et non-fakeout)
function computeSetupScore({ signal, orbRange, atr, adx, persistence }) {
  let points = 0;
  const maxPoints = 28;

  let notYetConfirmedByTime = false;
  if (persistence.minutesSinceBreakout < MIN_MINUTES_FOR_TOP_GRADE) {
    points += 0; notYetConfirmedByTime = true;
  } else if (persistence.minutesSinceBreakout < 20) {
    points += 4;
  } else {
    points += 6;
  }

  const rangeToAtrRatio = orbRange / atr;
  if (rangeToAtrRatio >= 0.8 && rangeToAtrRatio <= 2.5) points += 5;
  else points += 2;

  if (adx > 30) points += 5;
  else if (adx > 20) points += 3;
  else points += 0;

  const vol = persistence.relativeVolumeSinceBreakout;
  if (vol > 2) points += 4;
  else if (vol > 1.2) points += 2;
  else points += 0;

  if (persistence.priorFakeouts === 0) points += 4;
  else if (persistence.priorFakeouts === 1) points += 2;
  else points += 0;

  if (persistence.structureType === 'accumulation') points += 4;
  else if (persistence.structureType === 'spike') points += 1;
  else points += 2;

  const pct = points / maxPoints;
  let grade;
  if (pct >= 0.9) grade = 'S';
  else if (pct >= 0.75) grade = 'A';
  else if (pct >= 0.6) grade = 'B';
  else if (pct >= 0.4) grade = 'C';
  else if (pct >= 0.2) grade = 'D';
  else grade = 'E';

  if (notYetConfirmedByTime) {
    const order = ['S', 'A', 'B', 'C', 'D', 'E'];
    if (order.indexOf(grade) < order.indexOf('B')) grade = 'B';
  }

  return { grade, points, maxPoints };
}

// ------------------------------------------------------------
// RENDU DES RÉSULTATS
// ------------------------------------------------------------
function renderBacktestResults(trades, errors, tickers, dateFrom, dateTo) {
  if (trades.length === 0) {
    els.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="glyph">▤</div>
        <p>Aucun signal ORB valide trouvé sur cette période pour ces tickers. ${errors.length > 0 ? `<br><br><strong style="color:var(--bear)">Erreurs rencontrées :</strong><br>${errors.map(escapeHtml).join('<br>')}` : ''}</p>
      </div>
    `;
    return;
  }

  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  const closedEod = trades.filter(t => t.outcome === 'closed_eod').length;
  const resolved = wins + losses;
  const winrate = resolved > 0 ? ((wins / resolved) * 100).toFixed(1) : '—';

  const totalPnlR = trades.reduce((sum, t) => {
    const stopDist = Math.abs(t.entry - t.stop);
    return sum + (stopDist > 0 ? t.pnlPerShare / stopDist : 0);
  }, 0);

  const grades = ['S', 'A', 'B', 'C', 'D', 'E'];
  const gradeStats = grades.map(g => {
    const gTrades = trades.filter(t => t.grade === g && (t.outcome === 'win' || t.outcome === 'loss'));
    if (gTrades.length === 0) return null;
    const w = gTrades.filter(t => t.outcome === 'win').length;
    return { grade: g, winrate: ((w / gTrades.length) * 100).toFixed(0), count: gTrades.length };
  }).filter(Boolean);

  const rows = trades
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(t => {
      const outcomeLabel = { win: 'Gagné', loss: 'Perdu', closed_eod: 'Clôturé EOD' }[t.outcome];
      const rowClass = t.outcome === 'win' ? 'row-win' : t.outcome === 'loss' ? 'row-loss' : '';
      const dirColor = t.direction === 'long' ? 'var(--bull)' : 'var(--bear)';
      const stopDist = Math.abs(t.entry - t.stop);
      const pnlR = stopDist > 0 ? (t.pnlPerShare / stopDist).toFixed(2) : '—';
      return `
        <tr class="${rowClass}">
          <td style="font-weight:700; color:var(--text-bright);">${t.ticker}</td>
          <td style="color:var(--text-dim); font-family:var(--sans); font-size:11px;">${t.date}</td>
          <td style="color:${dirColor}; font-weight:600;">${t.direction === 'long' ? '▲' : '▼'}</td>
          <td>${t.grade}</td>
          <td>${t.entry.toFixed(2)}</td>
          <td>${t.exitPrice.toFixed(2)}</td>
          <td class="${t.pnlPerShare >= 0 ? 'up' : 'down'}">${pnlR}R</td>
          <td>${outcomeLabel}</td>
          <td style="font-size:11px; color:var(--text-dim);">${t.minutesSinceBreakout}min · ${t.priorFakeouts} fake · ${t.structureType === 'accumulation' ? 'accum.' : t.structureType === 'spike' ? 'spike' : '—'}</td>
        </tr>
      `;
    }).join('');

  els.resultsContainer.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Trades détectés</div>
        <div class="summary-value">${trades.length}</div>
        <div class="summary-sub">${tickers.length} ticker${tickers.length > 1 ? 's' : ''} · ${dateFrom} → ${dateTo}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Winrate résolu</div>
        <div class="summary-value" style="color:${resolved > 0 && wins / resolved > 0.33 ? 'var(--bull)' : 'var(--bear)'}">${winrate}%</div>
        <div class="summary-sub">${wins} gagnés · ${losses} perdus · ${closedEod} clôturés fin de journée</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">PnL cumulé (en R)</div>
        <div class="summary-value" style="color:${totalPnlR >= 0 ? 'var(--bull)' : 'var(--bear)'}">${totalPnlR >= 0 ? '+' : ''}${totalPnlR.toFixed(1)}R</div>
        <div class="summary-sub">Somme des gains/pertes en multiples du risque initial</div>
      </div>
    </div>

    ${gradeStats.length > 0 ? `
      <div style="font-family:var(--mono); font-size:12px; color:var(--text-dim); margin-bottom:16px;">
        Winrate par grade : ${gradeStats.map(g => `<strong style="color:var(--text-bright);">${g.grade}</strong>: ${g.winrate}% (${g.count})`).join(' · ')}
      </div>
    ` : ''}

    ${errors.length > 0 ? `<div class="error-state" style="margin-bottom:16px;">Erreurs partielles :<br>${errors.map(escapeHtml).join('<br>')}</div>` : ''}

    <div class="table-scroll">
      <table class="results-table">
        <thead>
          <tr>
            <th>Ticker</th><th>Date</th><th>Dir.</th><th>Grade</th><th>Entrée</th><th>Sortie</th><th>PnL</th><th>Résultat</th><th>Détail</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
