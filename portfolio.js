// ============================================================
// PORTFOLIO — calendrier de performance basé sur le journal ORB
// ============================================================

const HISTORY_KEY = 'orb-scanner-history'; // même clé que le journal ORB (app.js)
const BALANCE_MOVEMENTS_KEY = 'orb-portfolio-balance-movements';
const WORKER_URL = 'https://red-bush-d58eorbscanner.tom-vandendorpe.workers.dev/';
const ETF_WORLD_TICKER = 'VWCE.DE';   // Vanguard FTSE All-World — le même ETF que le DCA existant
const ETF_NASDAQ_TICKER = 'QQQ';       // Nasdaq 100 — le plus liquide/suivi sur Yahoo

const TIMEFRAMES = [
  { id: '24H', label: '24h' },
  { id: '1W', label: '1 semaine' },
  { id: '1M', label: '1 mois' },
  { id: 'YTD', label: 'YTD' },
  { id: '1Y', label: '1 an' },
  { id: 'MAX', label: 'Max' },
];

const els = {
  summaryContainer: document.getElementById('summary-container'),
  calendarContainer: document.getElementById('calendar-container'),
  dayDetailContainer: document.getElementById('day-detail-container'),
  chartPanelContainer: document.getElementById('chart-panel-container'),
  balancePanelContainer: document.getElementById('balance-panel-container'),
  comparePanelContainer: document.getElementById('compare-panel-container'),
};

let currentMonth = new Date().getMonth(); // 0-11
let currentYear = new Date().getFullYear();
let allTrades = [];
let currentTimeframe = '1M';
let pnlChart = null;
let compareChart = null;
let balanceMovements = [];

init();

function init() {
  allTrades = loadHistory();
  balanceMovements = loadBalanceMovements();
  renderSummary();
  renderCalendar();
  renderChartPanel();
  renderBalancePanel();
  renderComparePanel();
}

// ------------------------------------------------------------
// LECTURE DU JOURNAL — même format que app.js (avec migration de compatibilité)
// ------------------------------------------------------------
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Ne garde que les trades avec un PnL calculable (résolus ou clôturés manuellement avec montant connu)
    return parsed.filter(t => t && t.date && typeof t.pnl === 'number');
  } catch {
    return [];
  }
}

// ------------------------------------------------------------
// RÉSUMÉ GLOBAL
// ------------------------------------------------------------
function renderSummary() {
  if (allTrades.length === 0) {
    els.summaryContainer.innerHTML = '';
    return;
  }

  const totalPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
  const wins = allTrades.filter(t => t.pnl > 0).length;
  const losses = allTrades.filter(t => t.pnl < 0).length;
  const winrate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : '—';

  // Meilleur et pire jour
  const byDay = {};
  allTrades.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
  const dayEntries = Object.entries(byDay);
  const bestDay = dayEntries.length ? dayEntries.reduce((a, b) => a[1] > b[1] ? a : b) : null;
  const worstDay = dayEntries.length ? dayEntries.reduce((a, b) => a[1] < b[1] ? a : b) : null;

  els.summaryContainer.innerHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">PnL total</div>
        <div class="summary-value ${totalPnl >= 0 ? 'up' : 'down'}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Winrate</div>
        <div class="summary-value">${winrate}%</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Trades résolus</div>
        <div class="summary-value">${wins + losses}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Meilleur jour</div>
        <div class="summary-value up" style="font-size:16px;">${bestDay ? `+${bestDay[1].toFixed(2)}$` : '—'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Pire jour</div>
        <div class="summary-value down" style="font-size:16px;">${worstDay && worstDay[1] < 0 ? `${worstDay[1].toFixed(2)}$` : '—'}</div>
      </div>
    </div>
  `;
}

// ------------------------------------------------------------
// CALENDRIER
// ------------------------------------------------------------
function renderCalendar() {
  if (allTrades.length === 0) return; // garde l'empty-state du HTML initial

  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const weekdayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  // Agrège le PnL et le nombre de trades par jour (format YYYY-MM-DD)
  const byDay = {};
  allTrades.forEach(t => {
    if (!byDay[t.date]) byDay[t.date] = { pnl: 0, count: 0, trades: [] };
    byDay[t.date].pnl += t.pnl;
    byDay[t.date].count += 1;
    byDay[t.date].trades.push(t);
  });

  const firstOfMonth = new Date(currentYear, currentMonth, 1);
  const lastOfMonth = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastOfMonth.getDate();
  const startWeekday = firstOfMonth.getDay(); // 0 = dimanche

  let monthTotal = 0;
  const cells = [];

  // Cellules vides avant le 1er du mois
  for (let i = 0; i < startWeekday; i++) {
    cells.push(`<div class="day-cell empty"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayData = byDay[dateKey];

    if (!dayData) {
      cells.push(`<div class="day-cell"><div class="day-number">${day}</div></div>`);
      continue;
    }

    monthTotal += dayData.pnl;
    const cls = dayData.pnl > 0 ? 'positive' : dayData.pnl < 0 ? 'negative' : 'zero';
    const pnlCls = dayData.pnl > 0 ? 'up' : dayData.pnl < 0 ? 'down' : 'neutral';

    cells.push(`
      <div class="day-cell has-trades ${cls}" data-date="${dateKey}">
        <div class="day-number">${day}</div>
        <div>
          <div class="day-pnl ${pnlCls}">${dayData.pnl >= 0 ? '+' : ''}${dayData.pnl.toFixed(2)}$</div>
          <div class="day-trade-count">${dayData.count} trade${dayData.count > 1 ? 's' : ''}</div>
        </div>
      </div>
    `);
  }

  els.calendarContainer.innerHTML = `
    <div class="calendar-panel">
      <div class="calendar-controls">
        <button class="month-nav-btn" id="prev-month-btn">‹</button>
        <div class="month-label">${monthNames[currentMonth]} ${currentYear}</div>
        <button class="month-nav-btn" id="next-month-btn">›</button>
        <button class="today-btn" id="today-btn">Aujourd'hui</button>
      </div>
      <div class="weekday-row">
        ${weekdayLabels.map(w => `<div class="weekday-label">${w}</div>`).join('')}
      </div>
      <div class="calendar-grid">${cells.join('')}</div>
      <div class="total-profit-row">
        <span class="total-profit-label">Total du mois</span>
        <span class="total-profit-value ${monthTotal >= 0 ? 'up' : 'down'}">${monthTotal >= 0 ? '+' : ''}${monthTotal.toFixed(2)}$</span>
      </div>
    </div>
  `;

  document.getElementById('prev-month-btn').addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month-btn').addEventListener('click', () => changeMonth(1));
  document.getElementById('today-btn').addEventListener('click', goToToday);

  els.calendarContainer.querySelectorAll('.day-cell.has-trades').forEach(cell => {
    cell.addEventListener('click', () => renderDayDetail(cell.dataset.date, byDay[cell.dataset.date]));
  });
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  els.dayDetailContainer.innerHTML = '';
  renderCalendar();
}

function goToToday() {
  const now = new Date();
  currentMonth = now.getMonth();
  currentYear = now.getFullYear();
  els.dayDetailContainer.innerHTML = '';
  renderCalendar();
}

function renderDayDetail(dateKey, dayData) {
  const rows = dayData.trades.map(t => `
    <div class="trade-detail-row">
      <span class="trade-detail-ticker">${escapeHtml(t.ticker)}</span>
      <span class="trade-detail-dir" style="color:${t.direction === 'long' ? 'var(--bull)' : 'var(--bear)'}">${t.direction === 'long' ? '▲' : '▼'}</span>
      <span class="trade-detail-grade">${t.grade || '—'}</span>
      <span>${t.entry != null ? t.entry.toFixed(2) : '—'}</span>
      <span class="trade-detail-pnl ${t.pnl >= 0 ? 'up' : 'down'}">${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}$</span>
    </div>
  `).join('');

  els.dayDetailContainer.innerHTML = `
    <div class="day-detail-panel">
      <div class="day-detail-title">${formatDateLong(dateKey)} — ${dayData.trades.length} trade${dayData.trades.length > 1 ? 's' : ''}, ${dayData.pnl >= 0 ? '+' : ''}${dayData.pnl.toFixed(2)}$</div>
      ${rows}
    </div>
  `;
  els.dayDetailContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function formatDateLong(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ------------------------------------------------------------
// GRAPHIQUE — PnL cumulé dans le temps, avec sélecteur de timeframe
// ------------------------------------------------------------
function renderChartPanel() {
  if (allTrades.length === 0) {
    els.chartPanelContainer.innerHTML = '';
    return;
  }

  els.chartPanelContainer.innerHTML = `
    <div class="chart-panel">
      <div class="chart-panel-header">
        <div class="chart-panel-title">Évolution du PnL cumulé</div>
        <div class="timeframe-selector" id="timeframe-selector">
          ${TIMEFRAMES.map(tf => `<button class="timeframe-btn ${tf.id === currentTimeframe ? 'active' : ''}" data-tf="${tf.id}">${tf.label}</button>`).join('')}
        </div>
      </div>
      <div id="pnl-chart-container"></div>
    </div>
  `;

  document.getElementById('timeframe-selector').querySelectorAll('.timeframe-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTimeframe = btn.dataset.tf;
      renderChartPanel();
    });
  });

  renderPnlChart();
}

// Filtre les trades selon le timeframe sélectionné, en se basant sur la date (jour) du trade
function filterTradesByTimeframe(trades, timeframe) {
  const now = new Date();
  const todayKey = formatDateKey(now);

  if (timeframe === '24H') {
    // Pas d'heure précise dans le journal — équivalent pratique : les trades du jour même
    return trades.filter(t => t.date === todayKey);
  }
  if (timeframe === '1W') {
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    return trades.filter(t => new Date(t.date) >= weekAgo);
  }
  if (timeframe === '1M') {
    const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
    return trades.filter(t => new Date(t.date) >= monthAgo);
  }
  if (timeframe === 'YTD') {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    return trades.filter(t => new Date(t.date) >= yearStart);
  }
  if (timeframe === '1Y') {
    const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    return trades.filter(t => new Date(t.date) >= yearAgo);
  }
  return trades; // MAX
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderPnlChart() {
  const container = document.getElementById('pnl-chart-container');
  if (!container) return;

  const filtered = filterTradesByTimeframe(allTrades, currentTimeframe)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timestamp || 0) - (b.timestamp || 0));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="chart-empty-hint">Aucun trade sur cette période.</div>`;
    return;
  }

  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML = `<div class="chart-empty-hint">Graphique indisponible (librairie non chargée).</div>`;
    return;
  }

  container.innerHTML = '';

  // Agrège le PnL cumulé par jour (un point par jour, pas par trade individuel, plus lisible)
  const byDay = {};
  filtered.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
  const sortedDays = Object.keys(byDay).sort();

  let cumulative = 0;
  const points = sortedDays.map(dateKey => {
    cumulative += byDay[dateKey];
    const [y, m, d] = dateKey.split('-').map(Number);
    const time = Math.floor(new Date(y, m - 1, d).getTime() / 1000);
    return { time, value: cumulative };
  });

  pnlChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 300,
    layout: { background: { color: 'transparent' }, textColor: '#6B6D73', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#1A1B1F' }, horzLines: { color: '#1A1B1F' } },
    rightPriceScale: { borderColor: '#24262B' },
    timeScale: { borderColor: '#24262B', timeVisible: false },
  });

  const isPositive = points[points.length - 1].value >= 0;
  const lineColor = isPositive ? '#4A9B7F' : '#C4554A';

  const series = pnlChart.addAreaSeries({
    lineColor,
    topColor: isPositive ? 'rgba(74,155,127,0.25)' : 'rgba(196,85,74,0.25)',
    bottomColor: 'rgba(74,155,127,0.0)',
    lineWidth: 2,
    priceLineVisible: false,
  });

  series.setData(points);
  pnlChart.timeScale().fitContent();

  new ResizeObserver(entries => {
    if (entries.length === 0 || !pnlChart) return;
    pnlChart.applyOptions({ width: entries[0].contentRect.width });
  }).observe(container);
}

// ------------------------------------------------------------
// GESTION DE BALANCE — dépôts/retraits avec date, pour un calcul de
// performance correct (TWR) même quand de l'argent est ajouté plus tard.
// ------------------------------------------------------------
function loadBalanceMovements() {
  try {
    const raw = localStorage.getItem(BALANCE_MOVEMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveBalanceMovements(movements) {
  try { localStorage.setItem(BALANCE_MOVEMENTS_KEY, JSON.stringify(movements)); } catch { /* ignore */ }
}

function addBalanceMovement(date, amount, type) {
  balanceMovements.push({ id: `bm-${Date.now()}`, date, amount: type === 'withdrawal' ? -Math.abs(amount) : Math.abs(amount), type });
  balanceMovements.sort((a, b) => a.date.localeCompare(b.date));
  saveBalanceMovements(balanceMovements);
}

function removeBalanceMovement(id) {
  balanceMovements = balanceMovements.filter(m => m.id !== id);
  saveBalanceMovements(balanceMovements);
}

function renderBalancePanel() {
  const rows = balanceMovements.length > 0
    ? balanceMovements.map(m => `
        <tr>
          <td>${m.date}</td>
          <td style="color:${m.type === 'withdrawal' ? 'var(--bear)' : 'var(--bull)'}">${m.type === 'withdrawal' ? 'Retrait' : 'Dépôt'}</td>
          <td>${m.amount >= 0 ? '+' : ''}${m.amount.toFixed(2)}$</td>
          <td><button class="balance-remove-btn" data-id="${m.id}">Retirer</button></td>
        </tr>
      `).join('')
    : '';

  els.balancePanelContainer.innerHTML = `
    <div class="balance-panel">
      <div class="balance-panel-title">💰 Historique de balance</div>
      <div class="balance-panel-sub">
        Enregistre ta balance de départ et tout dépôt/retrait ultérieur, avec leur date — nécessaire pour calculer une performance en % juste (méthode Time-Weighted Return), qui ne se laisse pas fausser par l'argent que tu ajoutes en cours de route.
      </div>
      <div class="balance-form-row">
        <div class="balance-form-field">
          <label>Date</label>
          <input type="date" id="bm-date" value="${new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="balance-form-field">
          <label>Montant ($)</label>
          <input type="number" id="bm-amount" placeholder="230" step="0.01">
        </div>
        <div class="balance-form-field">
          <label>Type</label>
          <select id="bm-type">
            <option value="deposit">Dépôt</option>
            <option value="withdrawal">Retrait</option>
          </select>
        </div>
        <button class="balance-add-btn" id="bm-add-btn">+ Ajouter</button>
      </div>
      ${balanceMovements.length > 0 ? `
        <table class="balance-movements-table">
          <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      ` : `<div class="balance-empty-hint">Aucun mouvement enregistré — ajoute ta balance de départ pour commencer (ex: date de ton premier trade ORB, montant initial).</div>`}
    </div>
  `;

  document.getElementById('bm-add-btn').addEventListener('click', () => {
    const date = document.getElementById('bm-date').value;
    const amount = parseFloat(document.getElementById('bm-amount').value);
    const type = document.getElementById('bm-type').value;
    if (!date) { alert('Renseigne une date.'); return; }
    if (isNaN(amount) || amount <= 0) { alert('Montant invalide.'); return; }
    addBalanceMovement(date, amount, type);
    renderBalancePanel();
    renderComparePanel();
  });

  els.balancePanelContainer.querySelectorAll('.balance-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      removeBalanceMovement(btn.dataset.id);
      renderBalancePanel();
      renderComparePanel();
    });
  });
}

// ------------------------------------------------------------
// CALCUL TWR (Time-Weighted Return) — neutralise l'effet des dépôts/retraits
// pour ne mesurer que la vraie performance de la stratégie.
// ------------------------------------------------------------
function computeOrbTwrSeries() {
  if (balanceMovements.length === 0) return null;

  // Balance au fil du temps : commence au premier mouvement, augmentée/diminuée par
  // chaque dépôt/retrait, et par le PnL de chaque jour de trading.
  const pnlByDay = {};
  allTrades.forEach(t => { pnlByDay[t.date] = (pnlByDay[t.date] || 0) + t.pnl; });

  const firstDate = balanceMovements[0].date;
  const today = new Date().toISOString().slice(0, 10);

  // Construit la timeline jour par jour depuis le premier mouvement jusqu'à aujourd'hui
  const allDatesSet = new Set([...Object.keys(pnlByDay), ...balanceMovements.map(m => m.date)]);
  const timeline = [];
  let cursor = new Date(firstDate);
  const end = new Date(today);
  while (cursor <= end) {
    timeline.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  let balance = 0;
  let cumulativeReturn = 1; // facteur multiplicatif, part de 1 (= 0%)
  const series = [];

  for (const dateKey of timeline) {
    const movementsToday = balanceMovements.filter(m => m.date === dateKey);
    const balanceBeforeFlows = balance;

    // Applique les flux (dépôts/retraits) du jour
    movementsToday.forEach(m => { balance += m.amount; });

    // Applique le PnL du jour, s'il y en a un
    const pnlToday = pnlByDay[dateKey] || 0;
    if (pnlToday !== 0 && balanceBeforeFlows > 0) {
      const dailyReturn = pnlToday / balanceBeforeFlows;
      cumulativeReturn *= (1 + dailyReturn);
    }
    balance += pnlToday;

    const time = Math.floor(new Date(dateKey).getTime() / 1000);
    series.push({ time, value: (cumulativeReturn - 1) * 100 }); // en % depuis le départ
  }

  return series;
}

// ------------------------------------------------------------
// FETCH ETF — via le Worker Cloudflare existant
// ------------------------------------------------------------
async function fetchEtfDailyData(ticker, fromDate) {
  const url = `${WORKER_URL}?ticker=${encodeURIComponent(ticker)}&interval=1d&range=2y`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.chart?.error) throw new Error(data.chart.error.description || 'Erreur Yahoo');
  if (!data?.chart?.result?.[0]) throw new Error('Réponse vide');

  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;

  const fromTs = new Date(fromDate).getTime() / 1000;
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null || timestamps[i] < fromTs) continue;
    points.push({ time: timestamps[i], close: closes[i] });
  }
  return points;
}

function normalizeToPercent(points) {
  if (points.length === 0) return [];
  const base = points[0].close;
  return points.map(p => ({ time: p.time, value: ((p.close - base) / base) * 100 }));
}

// ------------------------------------------------------------
// RENDU — panneau de comparaison
// ------------------------------------------------------------
function renderComparePanel() {
  if (balanceMovements.length === 0) {
    els.comparePanelContainer.innerHTML = `
      <div class="compare-panel">
        <div class="compare-panel-header"><div class="balance-panel-title">📊 ORB vs ETF World vs ETF Nasdaq 100</div></div>
        <div class="chart-empty-hint">Renseigne d'abord ta balance de départ ci-dessus pour activer cette comparaison.</div>
      </div>
    `;
    return;
  }

  els.comparePanelContainer.innerHTML = `
    <div class="compare-panel">
      <div class="compare-panel-header">
        <div class="balance-panel-title">📊 ORB vs ETF World vs ETF Nasdaq 100</div>
        <button class="compare-refresh-btn" id="compare-refresh-btn">Actualiser les ETF</button>
      </div>
      <div class="compare-legend">
        <div class="compare-legend-item"><span class="compare-legend-swatch" style="background:#4A9B7F"></span>ORB (toi)</div>
        <div class="compare-legend-item"><span class="compare-legend-swatch" style="background:#D4A24C"></span>ETF World (VWCE.DE)</div>
        <div class="compare-legend-item"><span class="compare-legend-swatch" style="background:#9B7FD4"></span>ETF Nasdaq 100 (QQQ)</div>
      </div>
      <div id="compare-chart-container"></div>
      <div id="compare-summary-row" class="compare-summary-row"></div>
    </div>
  `;

  document.getElementById('compare-refresh-btn').addEventListener('click', loadAndRenderCompareChart);
  loadAndRenderCompareChart();
}

async function loadAndRenderCompareChart() {
  const container = document.getElementById('compare-chart-container');
  const summaryRow = document.getElementById('compare-summary-row');
  const btn = document.getElementById('compare-refresh-btn');
  if (!container) return;

  container.innerHTML = `<div class="chart-empty-hint">Chargement des données ETF...</div>`;
  if (btn) { btn.disabled = true; btn.textContent = 'Chargement...'; }

  try {
    const orbSeries = computeOrbTwrSeries();
    const fromDate = balanceMovements[0].date;

    const [worldPoints, nasdaqPoints] = await Promise.all([
      fetchEtfDailyData(ETF_WORLD_TICKER, fromDate),
      fetchEtfDailyData(ETF_NASDAQ_TICKER, fromDate),
    ]);

    const worldSeries = normalizeToPercent(worldPoints);
    const nasdaqSeries = normalizeToPercent(nasdaqPoints);

    renderCompareChart(orbSeries, worldSeries, nasdaqSeries);
    renderCompareSummary(orbSeries, worldSeries, nasdaqSeries, summaryRow);
  } catch (e) {
    container.innerHTML = `<div class="chart-empty-hint" style="color:var(--bear);">Erreur : ${escapeHtml(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Actualiser les ETF'; }
  }
}

function renderCompareChart(orbSeries, worldSeries, nasdaqSeries) {
  const container = document.getElementById('compare-chart-container');
  if (!container) return;

  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML = `<div class="chart-empty-hint">Graphique indisponible (librairie non chargée).</div>`;
    return;
  }

  container.innerHTML = '';

  compareChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 320,
    layout: { background: { color: 'transparent' }, textColor: '#6B6D73', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#1A1B1F' }, horzLines: { color: '#1A1B1F' } },
    rightPriceScale: { borderColor: '#24262B' },
    timeScale: { borderColor: '#24262B', timeVisible: false },
  });

  if (orbSeries && orbSeries.length > 0) {
    const orbLine = compareChart.addLineSeries({ color: '#4A9B7F', lineWidth: 2, priceLineVisible: false });
    orbLine.setData(orbSeries);
  }

  const worldLine = compareChart.addLineSeries({ color: '#D4A24C', lineWidth: 2, priceLineVisible: false });
  worldLine.setData(worldSeries);

  const nasdaqLine = compareChart.addLineSeries({ color: '#9B7FD4', lineWidth: 2, priceLineVisible: false });
  nasdaqLine.setData(nasdaqSeries);

  compareChart.timeScale().fitContent();

  new ResizeObserver(entries => {
    if (entries.length === 0 || !compareChart) return;
    compareChart.applyOptions({ width: entries[0].contentRect.width });
  }).observe(container);
}

function renderCompareSummary(orbSeries, worldSeries, nasdaqSeries, container) {
  if (!container) return;
  const lastOrb = orbSeries && orbSeries.length > 0 ? orbSeries[orbSeries.length - 1].value : null;
  const lastWorld = worldSeries.length > 0 ? worldSeries[worldSeries.length - 1].value : null;
  const lastNasdaq = nasdaqSeries.length > 0 ? nasdaqSeries[nasdaqSeries.length - 1].value : null;

  const fmt = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const color = (v) => v == null ? 'var(--text-dim)' : v >= 0 ? 'var(--bull)' : 'var(--bear)';

  container.innerHTML = `
    <div class="compare-summary-item"><span class="label">ORB (toi)</span><span style="color:${color(lastOrb)}">${fmt(lastOrb)}</span></div>
    <div class="compare-summary-item"><span class="label">ETF World</span><span style="color:${color(lastWorld)}">${fmt(lastWorld)}</span></div>
    <div class="compare-summary-item"><span class="label">ETF Nasdaq 100</span><span style="color:${color(lastNasdaq)}">${fmt(lastNasdaq)}</span></div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
