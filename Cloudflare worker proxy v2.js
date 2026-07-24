/**
 * Proxy CORS étendu — Yahoo Finance (scanner en direct) + StockData.org (backtest historique)
 *
 * C'est une VERSION ÉTENDUE de ton Worker existant (orb-scanner-proxy). Remplace le code
 * de ton Worker actuel par celui-ci pour ajouter le support StockData.org, nécessaire au
 * nouvel outil de backtest — sans rien casser du scanner en direct qui continue d'utiliser
 * la route Yahoo comme avant.
 *
 * NOUVEAU : il te faut une clé API StockData.org (gratuite) :
 * 1. Va sur https://www.stockdata.org/register et crée un compte gratuit.
 * 2. Récupère ta clé API dans ton dashboard.
 * 3. Dans le dashboard Cloudflare de ton Worker : Settings → Variables and Secrets
 *    → Add → nom "STOCKDATA_API_TOKEN", valeur = ta clé, type "Secret" → Deploy.
 *    (Ne mets JAMAIS la clé directement dans ce code — elle doit rester secrète côté Worker.)
 *
 * USAGE depuis le front-end (backtest.js) :
 *   https://<ton-worker>.workers.dev/?source=stockdata&symbols=AAPL&date_from=2024-01-01&date_to=2024-01-07
 *   https://<ton-worker>.workers.dev/?ticker=AAPL   (comportement Yahoo existant, inchangé)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const source = url.searchParams.get('source'); // 'stockdata' ou absent (= Yahoo, comportement existant)

    if (source === 'stockdata') {
      return handleStockData(url, env);
    }

    return handleYahoo(url);
  },
};

// ------------------------------------------------------------
// Route existante : Yahoo Finance (scanner en direct) — INCHANGÉE
// ------------------------------------------------------------
async function handleYahoo(url) {
  const ticker = url.searchParams.get('ticker');
  if (!ticker) {
    return jsonError('Paramètre "ticker" manquant', 400);
  }
  if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker)) {
    return jsonError('Ticker invalide', 400);
  }

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=5d`;

  try {
    const yahooRes = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ORBScanner/1.0)' },
    });
    const body = await yahooRes.text();
    return new Response(body, {
      status: yahooRes.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (e) {
    return jsonError('Yahoo injoignable: ' + String(e), 502);
  }
}

// ------------------------------------------------------------
// Nouvelle route : StockData.org (backtest historique)
// ------------------------------------------------------------
async function handleStockData(url, env) {
  const apiToken = env.STOCKDATA_API_TOKEN;
  if (!apiToken) {
    return jsonError('STOCKDATA_API_TOKEN non configuré côté Worker (voir instructions en haut du fichier)', 500);
  }

  const symbols = url.searchParams.get('symbols');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  if (!symbols) return jsonError('Paramètre "symbols" manquant', 400);
  if (!/^[A-Za-z0-9.,\-]{1,100}$/.test(symbols)) return jsonError('Format de symbols invalide', 400);

  const sdUrl = new URL('https://api.stockdata.org/v1/data/intraday');
  sdUrl.searchParams.set('symbols', symbols);
  sdUrl.searchParams.set('api_token', apiToken);
  if (dateFrom) sdUrl.searchParams.set('date_from', dateFrom);
  if (dateTo) sdUrl.searchParams.set('date_to', dateTo);

  try {
    const sdRes = await fetch(sdUrl.toString());
    const body = await sdRes.text();
    return new Response(body, {
      status: sdRes.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (e) {
    return jsonError('StockData.org injoignable: ' + String(e), 502);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
