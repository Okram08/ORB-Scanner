// ============================================================
// ORB SCANNER — logique principale
// ============================================================

const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const els = {
  input: document.getElementById('ticker-input'),
  orbWindow: document.getElementById('orb-window'),
  btn: document.getElementById('search-btn'),
  content: document.getElementById('content'),
};

let chart = null;
let candleSeries = null;

els.btn.addEventListener('click', runAnalysis);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });

async function runAnalysis() {
  const ticker = els.input.value.trim().toUpperCase();
  if (!ticker) return;

  const orbMinutes = parseInt(els.orbWindow.value, 10);

  setLoading(ticker);
  els.btn.disabled = true;

  try {
    const raw = await fetchYahooData(ticker);
    const parsed = parseYahooResponse(raw);
    if (!parsed || parsed.closes.length < 20) {
      throw new Error('Pas assez de données intraday pour ce ticker (marché fermé ou ticker invalide).');
    }
    const analysis = computeIndicators(parsed, orbMinutes);
    renderResults(ticker, parsed, analysis, orbMinutes);
  } catch (err) {
    setError(ticker, err.message);
  } finally {
    els.btn.disabled = false;
  }
}

// ------------------------------------------------------------
// FETCH — Yahoo Finance via proxy CORS (fallback en cascade)
// ------------------------------------------------------------
async function fetchYahooData(ticker) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=5d`;

  let lastErr;
  for (const proxyFn of CORS_PROXIES) {
    try {
      const res = await fetch(proxyFn(yahooUrl));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.chart?.error) throw new Error(data.chart.error.description || 'Ticker introuvable');
      if (!data?.chart?.result?.[0]) throw new Error('Réponse Yahoo vide');
      return data;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw new Error(`Impossible de récupérer les données (${lastErr?.message || 'proxies indisponibles'}). Réessaie dans quelques secondes.`);
}

function parseYahooResponse(raw) {
  const result = raw.chart.result[0];
  const meta = result.meta;
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];

  if (!timestamps || !quote) return null;

  const out = {
    meta,
    timestamps: [],
    opens: [], highs: [], lows: [], closes: [], volumes: [],
  };

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue; // skip holes (pre/post market gaps)
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
// INDICATEURS
// ------------------------------------------------------------
function computeIndicators(data, orbMinutes) {
  const { timestamps, opens, highs, lows, closes, volumes } = data;

  // Regrouper les bougies par jour de session (timezone du marché via meta.exchangeTimezoneName géré par Yahoo -> timestamps sont UTC epoch)
  const days = groupByTradingDay(timestamps);
  const lastDayKey = Object.keys(days).sort().pop();
  const lastDayIdx = days[lastDayKey];

  // --- ORB : range des N premières minutes de la dernière session ---
  const candlesPerOrb = Math.max(1, Math.round(orbMinutes / 5));
  const orbIdx = lastDayIdx.slice(0, candlesPerOrb);
  const orbHigh = Math.max(...orbIdx.map(i => highs[i]));
  const orbLow = Math.min(...orbIdx.map(i => lows[i]));

  const lastIdx = lastDayIdx[lastDayIdx.length - 1];
  const lastClose = closes[lastIdx];
  const prevClose = closes[lastDayIdx[0]] ?? closes[0];

  // --- VWAP (calculé sur la session du jour uniquement) ---
  let cumPV = 0, cumVol = 0;
  const vwapSeries = [];
  for (const i of lastDayIdx) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += typicalPrice * volumes[i];
    cumVol += volumes[i];
    vwapSeries.push(cumVol > 0 ? cumPV / cumVol : typicalPrice);
  }
  const currentVwap = vwapSeries[vwapSeries.length - 1];

  // --- ATR (14 périodes, sur toutes les bougies dispo, proxy pour ATR journalier) ---
  const atr = computeATR(highs, lows, closes, 14);

  // --- ADX (14 périodes) ---
  const adx = computeADX(highs, lows, closes, 14);

  // --- Volume relatif : volume moyen des bougies ORB vs volume moyen historique sur même créneau ---
  const orbVolume = orbIdx.reduce((s, i) => s + volumes[i], 0);
  const avgVolumePerCandle = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  const expectedOrbVolume = avgVolumePerCandle * candlesPerOrb;
  const relativeVolume = expectedOrbVolume > 0 ? orbVolume / expectedOrbVolume : 1;

  // --- Signal ---
  const priceAboveVwap = lastClose > currentVwap;
  const brokeHigh = lastClose > orbHigh;
  const brokeLow = lastClose < orbLow;
  const strongAdx = adx > 20;
  const strongVolume = relativeVolume > 1.2;

  let signal = 'neutral';
  let reasons = [];

  if (brokeHigh) {
    if (priceAboveVwap) reasons.push('prix au-dessus du VWAP');
    else reasons.push('⚠ prix sous le VWAP malgré le breakout');
    if (strongAdx) reasons.push(`ADX ${adx.toFixed(0)} confirme la tendance`);
    else reasons.push(`⚠ ADX ${adx.toFixed(0)} faible, tendance peu franche`);
    if (strongVolume) reasons.push(`volume ${relativeVolume.toFixed(1)}x la normale`);
    else reasons.push('⚠ volume insuffisant sur le breakout');

    signal = (priceAboveVwap && strongAdx && strongVolume) ? 'bull' : 'neutral';
  } else if (brokeLow) {
    if (!priceAboveVwap) reasons.push('prix sous le VWAP');
    else reasons.push('⚠ prix au-dessus du VWAP malgré le breakdown');
    if (strongAdx) reasons.push(`ADX ${adx.toFixed(0)} confirme la tendance`);
    else reasons.push(`⚠ ADX ${adx.toFixed(0)} faible, tendance peu franche`);
    if (strongVolume) reasons.push(`volume ${relativeVolume.toFixed(1)}x la normale`);
    else reasons.push('⚠ volume insuffisant sur le breakdown');

    signal = (!priceAboveVwap && strongAdx && strongVolume) ? 'bear' : 'neutral';
  } else {
    reasons.push('prix encore dans le range d\'ouverture, pas de breakout');
  }

  return {
    orbHigh, orbLow, orbVolume, candlesPerOrb,
    lastClose, prevClose, currentVwap, vwapSeries,
    atr, adx, relativeVolume,
    signal, reasons,
    lastDayIdx,
  };
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
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
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
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }

  const smooth = (arr, period) => {
    const out = [];
    let sum = arr.slice(0, period).reduce((s, v) => s + v, 0);
    out.push(sum);
    for (let i = period; i < arr.length; i++) {
      sum = sum - (sum / period) + arr[i];
      out.push(sum);
    }
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

// ------------------------------------------------------------
// RENDU
// ------------------------------------------------------------
function setLoading(ticker) {
  els.content.innerHTML = `
    <div class="loading-state">
      <span class="loading-dot"></span>Récupération des données pour ${ticker}...
    </div>`;
}

function setError(ticker, message) {
  els.content.innerHTML = `
    <div class="error-state">
      Erreur sur ${ticker} : ${escapeHtml(message)}
    </div>`;
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
    <div class="ticker-header">
      <div style="display:flex; align-items:center; gap:14px;">
        <div class="ticker-id">${ticker}</div>
        <div class="ticker-price">${a.lastClose.toFixed(2)}</div>
        <div class="ticker-change ${isUp ? 'up-bg' : 'down-bg'}">
          ${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePct.toFixed(2)}%)
        </div>
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
  `;

  renderChart(data, a);
}

function renderIndicatorCard(label, value, unit, subtext, tagType) {
  const tagClass = tagType === 'good' ? 'tag-good' : tagType === 'bad' ? 'tag-bad' : 'tag-warn';
  return `
    <div class="indicator-card">
      <div class="indicator-label">${label}</div>
      <div class="indicator-value">${value}${unit ? `<span class="indicator-unit">${unit}</span>` : ''}</div>
      ${tagType ? `<div class="indicator-tag ${tagClass}">${subtext}</div>` : `<div class="indicator-tag" style="background:var(--bg-panel-raised); color:var(--text-dim);">${subtext}</div>`}
    </div>
  `;
}

function renderChart(data, a) {
  const container = document.getElementById('chart-container');
  container.innerHTML = '';

  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 480,
    layout: {
      background: { color: 'transparent' },
      textColor: '#6B6D73',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
    },
    grid: {
      vertLines: { color: '#1A1B1F' },
      horzLines: { color: '#1A1B1F' },
    },
    rightPriceScale: { borderColor: '#24262B' },
    timeScale: { borderColor: '#24262B', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#4A9B7F',
    downColor: '#C4554A',
    borderUpColor: '#4A9B7F',
    borderDownColor: '#C4554A',
    wickUpColor: '#4A9B7F',
    wickDownColor: '#C4554A',
  });

  const candles = a.lastDayIdx.map(i => ({
    time: data.timestamps[i],
    open: data.opens[i],
    high: data.highs[i],
    low: data.lows[i],
    close: data.closes[i],
  }));
  candleSeries.setData(candles);

  // VWAP line
  const vwapLine = chart.addLineSeries({ color: '#7B8FA6', lineWidth: 2, priceLineVisible: false });
  vwapLine.setData(a.lastDayIdx.map((i, idx) => ({ time: data.timestamps[i], value: a.vwapSeries[idx] })));

  // ORB High/Low as horizontal price lines
  candleSeries.createPriceLine({ price: a.orbHigh, color: '#4A9B7F', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'ORB High' });
  candleSeries.createPriceLine({ price: a.orbLow, color: '#C4554A', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'ORB Low' });

  chart.timeScale().fitContent();

  new ResizeObserver(entries => {
    if (entries.length === 0 || !chart) return;
    chart.applyOptions({ width: entries[0].contentRect.width });
  }).observe(container);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
