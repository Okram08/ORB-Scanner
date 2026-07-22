/**
 * Proxy CORS dédié pour Yahoo Finance — à déployer sur Cloudflare Workers (gratuit).
 *
 * POURQUOI : les proxies CORS publics (corsproxy.io, allorigins.win...) sont gratuits
 * mais instables par nature — pannes fréquentes, rate-limits, ~50% d'échec par moments.
 * Ce Worker t'appartient : 100k requêtes/jour gratuites, aucune carte bancaire requise,
 * et il ne fait qu'une seule chose (proxifier Yahoo), donc rien à squatter/abuser.
 *
 * DÉPLOIEMENT (5 min, dashboard web, pas besoin d'installer wrangler) :
 * 1. Va sur https://dash.cloudflare.com/ et crée un compte gratuit (email + mdp suffit).
 * 2. Menu de gauche → "Workers & Pages" → "Create" → "Create Worker".
 * 3. Donne-lui un nom (ex: "orb-scanner-proxy") → "Deploy" (déploie le template par défaut).
 * 4. Clique "Edit code" → efface tout le contenu → colle le code ci-dessous → "Deploy".
 * 5. Note l'URL donnée (ex: https://orb-scanner-proxy.<ton-compte>.workers.dev).
 * 6. Dans app.js de ton repo, ajoute cette URL en PREMIER dans CORS_PROXIES (voir note en bas).
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Gérer la requête préliminaire CORS (preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const ticker = url.searchParams.get('ticker');
    if (!ticker) {
      return new Response(JSON.stringify({ error: 'Paramètre "ticker" manquant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // Whitelist basique du format de ticker pour éviter tout abus du proxy
    if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker)) {
      return new Response(JSON.stringify({ error: 'Ticker invalide' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
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
      return new Response(JSON.stringify({ error: 'Yahoo injoignable', detail: String(e) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * NOTE — modification à faire dans app.js une fois le Worker déployé :
 *
 * Ajoute ceci en tout premier élément du tableau CORS_PROXIES :
 *
 *   {
 *     name: 'cloudflare-worker',
 *     build: (url) => {
 *       const ticker = new URL(url).pathname.split('/').pop();
 *       return `https://orb-scanner-proxy.TON-COMPTE.workers.dev/?ticker=${ticker}`;
 *     },
 *     parse: (text) => JSON.parse(text),
 *   },
 *
 * (remplace TON-COMPTE par ton vrai sous-domaine workers.dev)
 */
