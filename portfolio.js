// ============================================================
// PORTFOLIO — calendrier de performance basé sur le journal ORB
// ============================================================

const HISTORY_KEY = 'orb-scanner-history'; // même clé que le journal ORB (app.js)

const els = {
  summaryContainer: document.getElementById('summary-container'),
  calendarContainer: document.getElementById('calendar-container'),
  dayDetailContainer: document.getElementById('day-detail-container'),
};

let currentMonth = new Date().getMonth(); // 0-11
let currentYear = new Date().getFullYear();
let allTrades = [];

init();

function init() {
  allTrades = loadHistory();
  renderSummary();
  renderCalendar();
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
