// ============================================================
// ORB SCANNER — logique principale
// ============================================================

// Chaque entrée : { build: fn(url) -> url proxifiée, parse: fn(responseText) -> JSON Yahoo }
// Certains proxies renvoient le JSON brut, d'autres l'enveloppent dans { contents: "..." } (allorigins /get).
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
};

// ------------------------------------------------------------
// FENÊTRE DE TRADING — 9h30-11h00 heure de marché US (America/New_York),
// soit ta fenêtre stratégique de 1h30 après l'ouverture. Calculé en heure
// de marché US directement (via Intl), donc pas de bug de décalage
// été/hiver Europe-US à gérer à la main.
// ------------------------------------------------------------
const SESSION_START_MIN = 9 * 60 + 30;  // 9h30 ET = ouverture NYSE/Nasdaq
const SESSION_END_MIN = 11 * 60;         // 11h00 ET = fin de la fenêtre ORB stratégique (1h30 après l'ouverture)

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

  // Convertit une minute-du-jour US en heure locale du navigateur, pour affichage
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
setInterval(renderSessionStatus, 60000); // rafraîchit chaque minute

// ------------------------------------------------------------
// BALANCE & GESTION DU RISQUE — persistant, pour calculer la taille
// de position optimale sur chaque trade (montant risqué = % fixe de la balance)
// ------------------------------------------------------------
const BALANCE_KEY = 'orb-scanner-balance';
const RISK_PCT_KEY = 'orb-scanner-risk-pct';
const DEFAULT_RISK_PCT = 1; // 1% de la balance risqué par trade, par défaut

function loadBalance() {
  try {
    const raw = localStorage.getItem(BALANCE_KEY);
    return raw ? parseFloat(raw) : null;
  } catch {
    return null;
  }
}

function saveBalance(value) {
  try { localStorage.setItem(BALANCE_KEY, String(value)); } catch { /* quota / navigation privée */ }
}

function loadRiskPct() {
  try {
    const raw = localStorage.getItem(RISK_PCT_KEY);
    return raw ? parseFloat(raw) : DEFAULT_RISK_PCT;
  } catch {
    return DEFAULT_RISK_PCT;
  }
}

function saveRiskPct(value) {
  try { localStorage.setItem(RISK_PCT_KEY, String(value)); } catch { /* quota / navigation privée */ }
}

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
  if (input === null) return; // annulé
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

// Calcule la taille de position optimale pour un niveau de trade donné (long ou short),
// en fonction de la balance et du % de risque renseignés. Retourne null si la balance
// n'est pas encore renseignée (pas de calcul possible).
function computePositionSize(entry, stop) {
  if (userBalance === null) return null;
  const riskAmount = userBalance * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  if (stopDistance <= 0) return null;
  // Pas d'arrondi entier : beaucoup de brokers (Trading212, DEGIRO, etc.) permettent
  // les actions fractionnées, donc le montant exact est plus utile qu'un nombre d'actions arrondi.
  const shares = riskAmount / stopDistance;
  const positionValue = shares * entry; // montant total à engager sur l'ordre
  return { shares, riskAmount, stopDistance, positionValue };
}

let chart = null;
let candleSeries = null;

const WATCHLIST_KEY = 'orb-scanner-watchlist';
let watchlist = loadWatchlist();

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  } catch {
    // stockage indisponible (navigation privée, quota) — on continue sans persister
  }
}

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

  // ré-attacher les listeners (le HTML a été régénéré)
  els.watchlistBar.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromWatchlist(btn.dataset.remove);
    });
  });

  const wInput = document.getElementById('watchlist-input');
  const wAddBtn = document.getElementById('watchlist-add-btn');
  wAddBtn.addEventListener('click', () => {
    addToWatchlist(wInput.value);
    wInput.value = '';
    wInput.focus();
  });
  wInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addToWatchlist(wInput.value); wInput.value = ''; }
  });

  document.getElementById('scan-all-btn')?.addEventListener('click', runScanAll);

  // clic sur un chip (hors bouton ×) → analyse détaillée directe
  els.watchlistBar.querySelectorAll('.watchlist-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      els.input.value = chip.dataset.ticker;
      runAnalysis();
    });
  });
}

renderWatchlistBar(); // rendu initial au chargement de la page

els.btn.addEventListener('click', runAnalysis);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });
document.getElementById('history-btn').addEventListener('click', renderHistoryPage);

// ------------------------------------------------------------
// SCORE FIGÉ — le score de qualité de setup est capturé au moment précis où le
// breakout est détecté pour la première fois (ticker + jour + direction), puis ne
// bouge plus pour le reste de la fenêtre. Sans ça, la "distance au prix actuel" fait
// sauter la note d'un scan à l'autre à cause du simple bruit de marché (le prix oscille
// de quelques ticks autour du niveau), ce qui casse la lecture "je regarde, je décide".
const FROZEN_SCORE_KEY = 'orb-scanner-frozen-scores';

function loadFrozenScores() {
  try {
    const raw = localStorage.getItem(FROZEN_SCORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFrozenScores(scores) {
  try { localStorage.setItem(FROZEN_SCORE_KEY, JSON.stringify(scores)); } catch { /* quota / navigation privée */ }
}

function getOrFreezeScore(ticker, signal, freshScore) {
  if (signal !== 'bull' && signal !== 'bear') return freshScore; // pas de breakout, rien à figer

  const today = new Date().toISOString().slice(0, 10);
  const key = `${ticker}|${today}|${signal}`;
  const scores = loadFrozenScores();

  if (scores[key]) {
    return scores[key]; // déjà figé pour ce breakout précis — on renvoie la version gelée
  }

  // Première détection de ce breakout aujourd'hui : on fige le score maintenant
  const frozenAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const frozen = { ...freshScore, frozenAt };
  scores[key] = frozen;
  saveFrozenScores(scores);
  return frozen;
}

// Récupère + calcule tout pour un ticker, sans toucher au DOM — réutilisable
// pour la vue détaillée (runAnalysis) et le scan groupé (runScanAll).
async function analyzeTicker(ticker, orbMinutes) {
  const raw = await fetchYahooData(ticker);
  const parsed = parseYahooResponse(raw);
  if (!parsed || parsed.closes.length < 20) {
    throw new Error('Pas assez de données intraday (marché fermé ou ticker invalide)');
  }
  const analysis = computeIndicators(parsed, orbMinutes);

  // Le score affiché est figé au moment de la première détection du breakout du jour —
  // stable ensuite, même si tu rescans plusieurs fois dans la fenêtre.
  analysis.setupScore = getOrFreezeScore(ticker, analysis.signal, analysis.setupScore);

  if (analysis.signal === 'bull' || analysis.signal === 'bear') {
    recordSignalToHistory(ticker, analysis, orbMinutes);
  }

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

// ------------------------------------------------------------
// SCAN GROUPÉ — watchlist entière en parallèle
// ------------------------------------------------------------
async function runScanAll() {
  if (watchlist.length === 0) return;

  const orbMinutes = parseInt(els.orbWindow.value, 10);
  const scanBtn = document.getElementById('scan-all-btn');
  if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = '⚡ Scan en cours...'; }

  // état initial : tout en "loading"
  const results = {};
  watchlist.forEach(t => { results[t] = { status: 'loading' }; });
  renderScanTable(results, orbMinutes);

  // lancer toutes les requêtes en parallèle, mettre à jour la ligne dès qu'un ticker répond
  await Promise.all(watchlist.map(async (ticker) => {
    try {
      const { analysis } = await analyzeTicker(ticker, orbMinutes);
      results[ticker] = { status: 'done', analysis };
    } catch (err) {
      results[ticker] = { status: 'error', message: err.message };
    }
    renderScanTable(results, orbMinutes);
  }));

  if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = `⚡ Scanner tout (${watchlist.length})`; }
}

function renderScanTable(results, orbMinutes) {
  const rows = watchlist.map(ticker => {
    const r = results[ticker];

    if (!r || r.status === 'loading') {
      return `
        <tr class="scan-row" data-ticker="${ticker}">
          <td class="scan-ticker">${ticker}</td>
          <td colspan="6"><span class="scan-signal-cell"><span class="scan-signal-dot dot-loading"></span>Analyse en cours...</span></td>
        </tr>`;
    }

    if (r.status === 'error') {
      return `
        <tr class="scan-row" data-ticker="${ticker}">
          <td class="scan-ticker">${ticker}</td>
          <td colspan="6"><span class="scan-signal-cell"><span class="scan-signal-dot dot-error"></span>${escapeHtml(r.message)}</span></td>
        </tr>`;
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

    return `
      <tr class="scan-row ${signalMeta.row}" data-ticker="${ticker}">
        <td class="scan-ticker">${ticker}</td>
        <td>
          <span class="scan-signal-cell">
            <span class="scan-signal-dot ${signalMeta.dot}"></span>${signalMeta.label}
          </span>
        </td>
        <td>${scoreCell}</td>
        <td>${a.lastClose.toFixed(2)}</td>
        <td class="${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${changePct.toFixed(2)}%</td>
        <td>ADX ${a.adx.toFixed(0)}</td>
        <td>Vol ${a.relativeVolume.toFixed(1)}x</td>
      </tr>`;
  }).join('');

  els.content.innerHTML = `
    <table class="scan-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Signal</th>
          <th>Score</th>
          <th>Prix</th>
          <th>Var. jour</th>
          <th>ADX</th>
          <th>Vol. relatif</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // clic sur une ligne (déjà résolue) → vue détaillée de ce ticker
  els.content.querySelectorAll('.scan-row').forEach(row => {
    const ticker = row.dataset.ticker;
    if (results[ticker]?.status === 'done') {
      row.addEventListener('click', () => {
        els.input.value = ticker;
        runAnalysis();
      });
    }
  });
}


// ------------------------------------------------------------
// FETCH — Yahoo Finance via proxy CORS (fallback en cascade)
// ------------------------------------------------------------
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
      const text = await res.text();
      const data = proxy.parse(text);

      if (data?.chart?.error) throw new Error(data.chart.error.description || 'Ticker introuvable');
      if (!data?.chart?.result?.[0]) throw new Error('Réponse vide');

      return data; // succès
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
// ------------------------------------------------------------
// SCORE DE QUALITÉ DE SETUP (S/A/B/C/D/E)
// ------------------------------------------------------------
// Ce n'est PAS une probabilité statistique — aucun backtest historique ne soutient
// un vrai pourcentage ici. C'est un score de règles : plus il est haut, plus le setup
// présente les caractéristiques qu'on a identifiées comme favorables à un ORB (distance
// raisonnable au niveau de breakout, confluence des filtres, range ni trop large ni trop
// étroit, tendance franche, volume confirmé). Documenté et transparent, pas une boîte noire.
function computeSetupScore({ signal, lastClose, orbHigh, orbLow, orbRange, atr, adx, relativeVolume, priceAboveVwap }) {
  // Cas "neutre" (pas encore de breakout confirmé) : on évalue quand même un score,
  // basé sur le côté du range le plus proche du prix actuel — utile pour repérer à
  // l'avance les tickers qui approchent d'un niveau avec un bon contexte, avant même
  // que le franchissement + la confluence des filtres ne confirment le signal.
  const distToHigh = orbHigh - lastClose;
  const distToLow = lastClose - orbLow;
  const isNeutral = signal === 'neutral';
  const isLong = isNeutral ? (distToHigh <= distToLow) : (signal === 'bull');
  const breakoutLevel = isLong ? orbHigh : orbLow;

  // Si le prix n'a pas encore cassé, la "distance" est comptée comme négative
  // (encore à l'intérieur du range) — donc pas de malus de type "trop loin",
  // juste une indication de proximité au niveau.
  const rawDistance = isLong ? (lastClose - breakoutLevel) : (breakoutLevel - lastClose);
  const distanceFromLevel = Math.abs(rawDistance);
  const distancePct = (distanceFromLevel / breakoutLevel) * 100;
  const notYetBroken = rawDistance < 0; // le prix est encore dans le range, côté évalué

  let points = 0;
  const maxPoints = 20;
  const details = [];

  if (isNeutral) {
    details.push(`ℹ Pas encore de breakout confirmé — score indicatif côté ${isLong ? 'haussier (ORB High)' : 'baissier (ORB Low)'}, le plus proche actuellement`);
  }

  // 1. Distance au niveau de breakout (max 6 pts) — critère le plus important pour
  //    savoir si un ordre limite a encore un sens. Si le prix n'a pas encore cassé,
  //    être proche du niveau est un BON signe (approche imminente) ; si le prix a déjà
  //    cassé, être loin est un MAUVAIS signe (le mouvement est déjà fait).
  let distanceTooFar = false;
  if (notYetBroken) {
    if (distancePct < 0.15) {
      points += 6; details.push(`✓ Prix tout proche du niveau ${isLong ? 'ORB High' : 'ORB Low'} (${distancePct.toFixed(2)}%) — cassure imminente possible`);
    } else if (distancePct < 0.4) {
      points += 4; details.push(`~ Prix se rapproche du niveau (${distancePct.toFixed(2)}%) — à surveiller`);
    } else {
      points += 2; details.push(`Prix encore loin du niveau (${distancePct.toFixed(2)}%) — rien d'imminent`);
    }
  } else if (distancePct < 0.15) {
    points += 6; details.push(`✓ Prix encore très proche du niveau de breakout (+${distancePct.toFixed(2)}%) — ordre limite pertinent`);
  } else if (distancePct < 0.4) {
    points += 4; details.push(`~ Prix modérément éloigné du niveau (+${distancePct.toFixed(2)}%) — encore jouable`);
  } else if (distancePct < 0.8) {
    points += 2; details.push(`⚠ Prix déjà bien éloigné du niveau (+${distancePct.toFixed(2)}%) — ordre limite risque de ne jamais se déclencher`);
    distanceTooFar = true;
  } else {
    points += 0; details.push(`✗ Prix trop loin du niveau de breakout (+${distancePct.toFixed(2)}%) — trop tard pour un ordre limite propre`);
    distanceTooFar = true;
  }

  // 2. Qualité du range ORB vs ATR (max 5 pts) — un range ni trop large (risque énorme)
  //    ni trop étroit (fakeout quasi garanti) par rapport à la volatilité normale du titre
  const rangeToAtrRatio = orbRange / atr;
  if (rangeToAtrRatio >= 0.8 && rangeToAtrRatio <= 2.5) {
    points += 5; details.push(`✓ Range ORB bien proportionné à la volatilité (${rangeToAtrRatio.toFixed(1)}× ATR)`);
  } else if (rangeToAtrRatio < 0.8) {
    points += 2; details.push(`⚠ Range ORB étroit vs volatilité normale (${rangeToAtrRatio.toFixed(1)}× ATR) — risque de fakeout plus élevé`);
  } else {
    points += 2; details.push(`⚠ Range ORB très large (${rangeToAtrRatio.toFixed(1)}× ATR) — stop potentiellement coûteux`);
  }

  // 3. Force de la tendance ADX (max 5 pts)
  if (adx > 30) {
    points += 5; details.push(`✓ ADX ${adx.toFixed(0)} — tendance forte, bon terrain pour un breakout qui continue`);
  } else if (adx > 20) {
    points += 3; details.push(`~ ADX ${adx.toFixed(0)} — tendance modérée`);
  } else {
    points += 0; details.push(`✗ ADX ${adx.toFixed(0)} — marché en range, risque de retournement`);
  }

  // 4. Volume relatif (max 4 pts)
  if (relativeVolume > 2) {
    points += 4; details.push(`✓ Volume ${relativeVolume.toFixed(1)}× la normale — forte conviction`);
  } else if (relativeVolume > 1.2) {
    points += 2; details.push(`~ Volume ${relativeVolume.toFixed(1)}× la normale — correct`);
  } else {
    points += 0; details.push(`✗ Volume ${relativeVolume.toFixed(1)}× la normale — participation faible`);
  }

  const pct = points / maxPoints;
  let grade;
  if (pct >= 0.9) grade = 'S';
  else if (pct >= 0.75) grade = 'A';
  else if (pct >= 0.6) grade = 'B';
  else if (pct >= 0.4) grade = 'C';
  else if (pct >= 0.2) grade = 'D';
  else grade = 'E';

  // Plafond : si le prix est déjà trop loin du niveau de breakout, un ordre limite n'a
  // plus vraiment de sens quel que soit le reste du contexte — donc le grade ne peut
  // pas dépasser D, pour éviter qu'un bon ADX/volume masque ce problème pratique.
  if (distanceTooFar) {
    const gradeOrder = ['S', 'A', 'B', 'C', 'D', 'E'];
    const currentIdx = gradeOrder.indexOf(grade);
    const dIdx = gradeOrder.indexOf('D');
    if (currentIdx < dIdx) grade = 'D';
  }

  // Plafond additionnel : tant qu'aucun breakout n'est confirmé (signal encore neutre),
  // le grade ne peut pas dépasser B — un bon contexte n'est qu'une anticipation, pas
  // un signal validé par la confluence VWAP + ADX + volume sur un vrai franchissement.
  if (isNeutral) {
    const gradeOrder = ['S', 'A', 'B', 'C', 'D', 'E'];
    const currentIdx = gradeOrder.indexOf(grade);
    const bIdx = gradeOrder.indexOf('B');
    if (currentIdx < bIdx) grade = 'B';
  }

  return { grade, points, maxPoints, details, distancePct, isNeutral, isLong };
}

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

  // --- Niveaux de trade (long / short) ---
  // Règle : stop à l'opposé du range ORB (niveau structurel — c'est justement le niveau
  // que le prix vient de casser), mais plafonné à 1.5x ATR pour éviter un risque démesuré
  // les jours où le range ORB est anormalement large. Target en ratio 2:1 (rapport
  // risque/reward le plus robuste empiriquement pour ce type de stratégie).
  const RR_RATIO = 2;
  const MAX_STOP_ATR_MULT = 1.5;
  const orbRange = orbHigh - orbLow;
  const maxStopDistance = atr * MAX_STOP_ATR_MULT;

  // LONG : entrée à l'ORB High (niveau de breakout), stop sous l'ORB Low
  const longEntry = orbHigh;
  const longStopDistance = Math.min(orbRange, maxStopDistance);
  const longStop = longEntry - longStopDistance;
  const longTarget = longEntry + longStopDistance * RR_RATIO;
  const longStopCapped = longStopDistance < orbRange; // true si l'ATR a limité le stop

  // SHORT : entrée à l'ORB Low, stop au-dessus de l'ORB High
  const shortEntry = orbLow;
  const shortStopDistance = Math.min(orbRange, maxStopDistance);
  const shortStop = shortEntry + shortStopDistance;
  const shortTarget = shortEntry - shortStopDistance * RR_RATIO;
  const shortStopCapped = shortStopDistance < orbRange;

  const tradeLevels = {
    long: { entry: longEntry, stop: longStop, target: longTarget, stopCapped: longStopCapped, rr: RR_RATIO },
    short: { entry: shortEntry, stop: shortStop, target: shortTarget, stopCapped: shortStopCapped, rr: RR_RATIO },
  };

  // --- Score de qualité de setup (pour décider si un ordre limite est pertinent) ---
  // IMPORTANT : ceci n'est PAS une probabilité statistique de réussite — juste un score
  // de qualité basé sur des règles connues (distance au niveau, confluence des filtres,
  // qualité du range, force de tendance, volume). Un "S" ne garantit rien ; ça veut dire
  // que le setup a les caractéristiques d'un bon setup ORB sur le papier.
  const setupScore = computeSetupScore({
    signal, lastClose, orbHigh, orbLow, orbRange, atr, adx, relativeVolume,
    priceAboveVwap,
  });

  return {
    orbHigh, orbLow, orbVolume, candlesPerOrb,
    lastClose, prevClose, currentVwap, vwapSeries,
    atr, adx, relativeVolume,
    signal, reasons,
    lastDayIdx,
    tradeLevels, setupScore,
  };
}

// ------------------------------------------------------------
// HISTORIQUE DES SIGNAUX — persistant, pour comparer jour après jour
// ------------------------------------------------------------
const HISTORY_KEY = 'orb-scanner-history';
const HISTORY_MAX_ENTRIES = 500; // évite une croissance illimitée du localStorage

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // quota dépassé ou navigation privée — on continue sans persister
  }
}

// Une entrée = un signal confirmé pour un ticker un jour donné.
// Clé de dédoublonnage : ticker + jour + direction du signal (pas d'entrée en double
// si tu rescans le même ticker plusieurs fois dans la même séance).
function recordSignalToHistory(ticker, analysis, orbMinutes) {
  const history = loadHistory();
  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = `${ticker}|${today}|${analysis.signal}`;

  if (history.some(h => h.dedupeKey === dedupeKey)) return; // déjà enregistré aujourd'hui

  const levels = analysis.signal === 'bull' ? analysis.tradeLevels.long : analysis.tradeLevels.short;

  history.unshift({
    dedupeKey,
    ticker,
    date: today,
    timestamp: Date.now(),
    signal: analysis.signal,
    orbMinutes,
    entry: levels.entry,
    stop: levels.stop,
    target: levels.target,
    priceAtSignal: analysis.lastClose,
    adx: analysis.adx,
    relativeVolume: analysis.relativeVolume,
  });

  saveHistory(history.slice(0, HISTORY_MAX_ENTRIES));
}

// Détermine si un trade historique a depuis touché son TP ou son SL,
// en se basant sur les données intraday les plus récentes déjà chargées pour ce ticker.
// Best-effort : si on n'a pas re-fetché ce ticker depuis, le statut reste "en cours".
function evaluateHistoryOutcome(entry, freshData) {
  if (!freshData) return 'pending';

  const isLong = entry.signal === 'bull';
  // on ne regarde que les bougies postérieures au moment du signal
  const relevantIdx = freshData.timestamps
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t * 1000 >= entry.timestamp);

  for (const { i } of relevantIdx) {
    if (isLong) {
      if (freshData.lows[i] <= entry.stop) return 'loss';
      if (freshData.highs[i] >= entry.target) return 'win';
    } else {
      if (freshData.highs[i] >= entry.stop) return 'loss';
      if (freshData.lows[i] <= entry.target) return 'win';
    }
  }
  return 'pending';
}

function renderHistoryPage() {
  const history = loadHistory();

  if (history.length === 0) {
    els.content.innerHTML = `
      ${renderBackToScanIfNeeded()}
      <div class="empty-state">
        <div class="glyph">◷</div>
        <p>Aucun signal confirmé enregistré pour l'instant. Dès qu'un breakout haussier ou baissier valide apparaît sur un ticker analysé, il est ajouté ici automatiquement.</p>
      </div>
    `;
    return;
  }

  const wins = history.filter(h => h._outcome === 'win').length;
  const losses = history.filter(h => h._outcome === 'loss').length;
  const pending = history.filter(h => !h._outcome || h._outcome === 'pending').length;
  const resolved = wins + losses;
  const winrate = resolved > 0 ? ((wins / resolved) * 100).toFixed(0) : '—';

  const rows = history.map(h => {
    const outcome = h._outcome || 'pending';
    const outcomeMeta = {
      win: { label: 'TP touché', cls: 'tag-good' },
      loss: { label: 'SL touché', cls: 'tag-bad' },
      pending: { label: 'En cours', cls: 'tag-warn' },
    }[outcome];

    const dirLabel = h.signal === 'bull' ? '▲ Long' : '▼ Short';
    const dirColor = h.signal === 'bull' ? 'var(--bull)' : 'var(--bear)';

    return `
      <tr>
        <td class="scan-ticker">${h.ticker}</td>
        <td style="font-family:var(--sans); font-size:12px; color:var(--text-dim)">${h.date}</td>
        <td style="color:${dirColor}; font-weight:600;">${dirLabel}</td>
        <td>${h.entry.toFixed(2)}</td>
        <td style="color:var(--bear)">${h.stop.toFixed(2)}</td>
        <td style="color:var(--bull)">${h.target.toFixed(2)}</td>
        <td><span class="indicator-tag ${outcomeMeta.cls}">${outcomeMeta.label}</span></td>
      </tr>
    `;
  }).join('');

  els.content.innerHTML = `
    ${renderBackToScanIfNeeded()}
    <div class="ticker-header">
      <div class="ticker-id" style="font-size:20px;">Historique des signaux</div>
    </div>

    <div class="signal-banner signal-neutral" style="margin-bottom:20px;">
      <span>${history.length} signal${history.length > 1 ? 's' : ''} enregistré${history.length > 1 ? 's' : ''}</span>
      <span class="signal-detail">${wins} gagnant${wins > 1 ? 's' : ''} · ${losses} perdant${losses > 1 ? 's' : ''} · ${pending} en cours${resolved > 0 ? ` · winrate résolu: ${winrate}%` : ''}</span>
    </div>

    <table class="scan-table">
      <thead>
        <tr>
          <th>Ticker</th><th>Date</th><th>Direction</th><th>Entrée</th><th>Stop</th><th>Target</th><th>Résultat</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="margin-top:16px;">
      <button class="back-to-scan" id="clear-history-btn">Effacer l'historique</button>
    </div>
  `;

  document.getElementById('clear-history-btn')?.addEventListener('click', () => {
    if (confirm('Effacer tout l\'historique des signaux ? Cette action est irréversible.')) {
      saveHistory([]);
      renderHistoryPage();
    }
  });

  document.getElementById('back-to-scan-btn-hist')?.addEventListener('click', runScanAll);

  // Best-effort : tente de résoudre le statut (win/loss/pending) des entrées récentes
  // en re-fetchant les tickers concernés, sans bloquer l'affichage initial.
  resolveHistoryOutcomes(history);
}

async function resolveHistoryOutcomes(history) {
  const tickers = [...new Set(history.filter(h => !h._outcome || h._outcome === 'pending').map(h => h.ticker))];
  if (tickers.length === 0) return;

  let changed = false;
  for (const ticker of tickers) {
    try {
      const raw = await fetchYahooData(ticker);
      const freshData = parseYahooResponse(raw);
      history.forEach(h => {
        if (h.ticker === ticker) {
          const outcome = evaluateHistoryOutcome(h, freshData);
          if (outcome !== 'pending' && h._outcome !== outcome) {
            h._outcome = outcome;
            changed = true;
          }
        }
      });
    } catch {
      // ticker injoignable pour l'instant — on laisse en pending, pas bloquant
    }
  }

  if (changed) {
    saveHistory(history);
    renderHistoryPage(); // ré-affiche avec les statuts à jour
  }
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
    ${watchlist.length > 0 ? `<button class="back-to-scan" id="back-to-scan-btn">← Retour au scan (${watchlist.length} tickers)</button>` : ''}
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

    ${renderSetupScore(a)}
    ${renderTradeLevels(a)}
  `;

  renderChart(data, a);

  document.getElementById('back-to-scan-btn')?.addEventListener('click', () => {
    const orbMinutes = parseInt(els.orbWindow.value, 10);
    // Ré-affiche le dernier scan sans refaire les requêtes réseau si possible :
    // on relance simplement un scan complet (plus simple et toujours à jour).
    runScanAll();
  });
}

function renderSetupScore(a) {
  const s = a.setupScore;

  const gradeColors = {
    S: 'var(--bull)', A: 'var(--bull)', B: 'var(--warn)',
    C: 'var(--warn)', D: 'var(--bear)', E: 'var(--bear)',
  };
  const gradeVerdict = {
    S: 'Setup excellent — ordre limite proche du niveau a du sens',
    A: 'Bon setup — ordre limite raisonnable',
    B: s.isNeutral ? 'En approche — surveille, mais pas encore de breakout confirmé' : 'Setup correct mais avec réserves — regarde les détails',
    C: 'Setup moyen — sois prudent',
    D: 'Setup faible — probablement à éviter',
    E: 'Setup très faible — à éviter',
  };
  const color = gradeColors[s.grade];
  const cardTitle = s.isNeutral
    ? `Score indicatif — pas encore de breakout confirmé (côté ${s.isLong ? 'ORB High' : 'ORB Low'})`
    : 'Qualité de setup (ordre limite) — breakout confirmé';

  const detailsHtml = s.details.map(d => `<div style="padding:4px 0; font-size:12px; color:var(--text);">${escapeHtml(d)}</div>`).join('');
  const frozenBadge = s.frozenAt ? `<div style="font-size:11px; color:var(--vwap); font-family:var(--mono); margin-top:4px;">🔒 Score figé à ${s.frozenAt} — stable pour le reste de la séance</div>` : '';

  return `
    <div class="indicator-card" style="margin-top:20px; border-color:${color}; ${s.isNeutral ? 'border-style:dashed;' : ''}">
      <div style="display:flex; align-items:center; gap:16px; margin-bottom:10px;">
        <div style="font-family:var(--mono); font-size:42px; font-weight:700; color:${color}; line-height:1;">${s.grade}</div>
        <div>
          <div class="indicator-label" style="margin-bottom:2px;">${cardTitle}</div>
          <div style="font-size:13px; font-weight:600; color:var(--text-bright);">${gradeVerdict[s.grade]}</div>
          <div style="font-size:11px; color:var(--text-dim); font-family:var(--mono); margin-top:2px;">${s.points}/${s.maxPoints} points — score de règles, pas une probabilité statistique</div>
          ${frozenBadge}
        </div>
      </div>
      ${detailsHtml}
    </div>
  `;
}

function renderTradeLevels(a) {
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
    if (!sizing) {
      return `<div class="position-size-row"><span class="label">Montant à investir</span><span class="value" style="color:var(--text-dim); font-weight:400;">renseigne ta balance ci-dessus</span></div>`;
    }
    return `<div class="position-size-row"><span class="label">Montant à investir (${riskPct}% risqué)</span><span class="value">${sizing.positionValue.toLocaleString('fr-BE', { maximumFractionDigits: 2 })}$ <span style="color:var(--text-dim); font-weight:400; font-size:11px;">(${sizing.shares.toFixed(3)} actions · ~${sizing.riskAmount.toFixed(2)}$ risqués si SL touché)</span></span></div>`;
  };

  return `
    <div class="trade-levels">
      <div class="trade-card ${isLongActive ? 'active-long' : ''}">
        <div class="trade-card-header">
          <span class="trade-card-title long-title">▲ Long</span>
          ${isLongActive ? '<span class="trade-active-badge">SIGNAL ACTIF</span>' : ''}
        </div>
        <div class="trade-row"><span class="trade-row-label">Entrée (ORB High)</span><span class="trade-row-value">${long.entry.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Stop-loss</span><span class="trade-row-value" style="color:var(--bear)">${long.stop.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Take-profit (${long.rr}:1)</span><span class="trade-row-value" style="color:var(--bull)">${long.target.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Risque / Reward</span><span class="trade-row-value">${riskLong.toFixed(2)} / ${rewardLong.toFixed(2)}</span></div>
        ${renderSizingRow(sizingLong)}
        <div class="trade-card-note">${long.stopCapped ? 'Stop plafonné à 1.5× ATR (range ORB plus large que la normale)' : 'Stop à l\'opposé exact du range ORB'}</div>
      </div>

      <div class="trade-card ${isShortActive ? 'active-short' : ''}">
        <div class="trade-card-header">
          <span class="trade-card-title short-title">▼ Short</span>
          ${isShortActive ? '<span class="trade-active-badge">SIGNAL ACTIF</span>' : ''}
        </div>
        <div class="trade-row"><span class="trade-row-label">Entrée (ORB Low)</span><span class="trade-row-value">${short.entry.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Stop-loss</span><span class="trade-row-value" style="color:var(--bear)">${short.stop.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Take-profit (${short.rr}:1)</span><span class="trade-row-value" style="color:var(--bull)">${short.target.toFixed(2)}</span></div>
        <div class="trade-row"><span class="trade-row-label">Risque / Reward</span><span class="trade-row-value">${riskShort.toFixed(2)} / ${rewardShort.toFixed(2)}</span></div>
        ${renderSizingRow(sizingShort)}
        <div class="trade-card-note">${short.stopCapped ? 'Stop plafonné à 1.5× ATR (range ORB plus large que la normale)' : 'Stop à l\'opposé exact du range ORB'}</div>
      </div>
    </div>
  `;
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

  if (typeof LightweightCharts === 'undefined') {
    container.innerHTML = `<div class="error-state">La librairie de graphique n'a pas pu se charger (CDN indisponible). Les indicateurs ci-contre restent valides — recharge la page dans quelques secondes.</div>`;
    return;
  }

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
