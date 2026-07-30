// ============================================================
// GUIDES-DATA — contenu de chaque guide de stratégie.
//
// Pour ajouter une nouvelle stratégie au site : ajoute simplement une nouvelle
// entrée dans le tableau STRATEGY_GUIDES ci-dessous. La page guides.html
// se met à jour automatiquement (nouvel onglet + contenu), sans toucher à guides.js.
// ============================================================

const STRATEGY_GUIDES = [
  {
    id: 'orb',
    name: 'ORB Scanner',
    color: '#4A9B7F',
    toolLink: 'index.html',
    toolLinkLabel: 'Ouvrir le scanner ORB',
    tagline: 'Intraday · 15h30–17h · Opening Range Breakout',
    sections: [
      {
        heading: 'Principe',
        paragraphs: [
          "L'ORB (Opening Range Breakout) part du constat que les premières minutes après l'ouverture du marché concentrent l'essentiel de l'information : ordres accumulés overnight, réactions aux news, volume institutionnel. Le range formé durant cette période (15 minutes par défaut) sert de référence : un franchissement de ce range avec confirmation (tendance, volume) signale un mouvement qui a des chances de continuer dans la journée.",
          "C'est une stratégie <strong>intraday</strong> — ouverte et fermée dans la même séance, jamais tenue overnight.",
        ],
      },
      {
        heading: 'Les signaux',
        signalTable: [
          { signal: '▲ BREAKOUT HAUSSIER', cls: 'signal-buy', meaning: "Prix au-dessus de l'ORB High, VWAP + ADX + volume alignés", action: 'Envisager un LONG' },
          { signal: '▼ BREAKOUT BAISSIER', cls: 'signal-sell', meaning: "Prix sous l'ORB Low, VWAP + ADX + volume alignés", action: 'Envisager un SHORT' },
          { signal: '— PAS DE SIGNAL', cls: 'signal-wait', meaning: 'Encore dans le range, ou cassure sans confluence', action: 'Ne rien faire' },
        ],
        paragraphs: ["Il n'y a jamais de signal « vendre une position existante » — chaque trade ORB est ouvert et fermé le jour même."],
      },
      {
        heading: 'Le score de qualité (S / A / B / C / D / E)',
        paragraphs: [
          'Ne remplace pas le signal — il qualifie à quel point le setup est propre, une fois le signal confirmé.',
        ],
        list: [
          '<strong>Persistance</strong> : le niveau doit tenir au moins 10 minutes sans retour dans le range, sinon le grade est plafonné à B',
          '<strong>Range vs ATR</strong> : ni trop large (stop coûteux) ni trop étroit (fakeout probable)',
          '<strong>ADX</strong> : force de la tendance',
          '<strong>Volume depuis la cassure</strong> : conviction réelle ou participation faible',
          '<strong>Faux breakouts précédents</strong> : un niveau déjà testé et refusé inspire moins confiance',
          '<strong>Structure pré-cassure</strong> : accumulation progressive (bon signe) vs spike soudain (fragile)',
        ],
      },
      {
        heading: 'Fenêtre de trading',
        list: [
          '<strong>15h30–15h45</strong> (heure Bruxelles) : le range se forme, pas de signal encore',
          '<strong>15h45–17h00</strong> : fenêtre utile, tu scannes et agis si un signal net apparaît',
          '<strong>Après 17h</strong> : tu arrêtes, journée « no trade » si rien n\'est confirmé',
        ],
      },
      {
        heading: 'Gestion du risque',
        list: [
          "Stop-loss : opposé du range ORB, plafonné à 1.5× ATR",
          'Take-profit : ratio 2:1',
          'Taille de position : 1% de balance risqué par trade',
          'Position ouverte non résolue : clôturée à 22h, jamais overnight',
          'Ordre limite non déclenché : annulé en fin de fenêtre (17h)',
        ],
      },
    ],
    limitBox: "Aucun de ces critères n'a été validé par un vrai backtest massif au départ — c'est construit sur des règles ORB reconnues, pas sur des milliers de trades historiques analysés. Le journal de suivi et le backtest sont là pour vérifier, avec tes propres données, si le système fonctionne réellement pour toi.",
  },

  {
    id: 'trend-following',
    name: 'Trend Following (Or)',
    color: '#D4A24C',
    toolLink: 'trend-following.html',
    toolLinkLabel: 'Ouvrir Trend Following',
    tagline: 'Long terme · Mensuel · MM50/MM200 sur Or',
    sections: [
      {
        heading: 'Principe',
        paragraphs: [
          'Le trend following classique (croisement de moyennes mobiles 50/200 jours) est l\'une des méthodes les plus documentées en gestion systématique : on reste investi tant que la tendance de fond est haussière, on n\'investit plus quand elle devient baissière. C\'est une stratégie <strong>long terme</strong> (semaines à mois), pas intraday.',
        ],
      },
      {
        heading: "Pourquoi l'or, et pas des actions",
        paragraphs: [
          'Le DCA passif existant (Nasdaq 100 + FTSE All-World) couvre déjà les actions mondiales. L\'or est <strong>décorrélé des actions</strong> — historiquement il performe le mieux précisément quand les actions traditionnelles souffrent. Appliquer le Trend Following à l\'or plutôt qu\'à un indice actions évite un doublon avec le DCA et ajoute une vraie diversification.',
        ],
      },
      {
        heading: 'Les signaux',
        signalTable: [
          { signal: 'INVESTIR CE MOIS-CI', cls: 'signal-buy', meaning: 'Golden Cross actif (prix + MM50 au-dessus de la MM200)', action: 'Acheter 200€ sur l\'ETC Or' },
          { signal: 'GARDER LE CASH', cls: 'signal-wait', meaning: 'Death Cross actif (prix + MM50 sous la MM200)', action: 'Ne rien acheter ce mois-ci' },
          { signal: 'SIGNAL MIXTE', cls: 'signal-caution', meaning: 'Prix et MM50 pas alignés — phase de transition', action: 'Prudence, lire le détail' },
        ],
        paragraphs: [
          "Il n'y a <strong>volontairement pas de signal « VENDRE »</strong> — ce qui est déjà acheté reste en portefeuille comme réserve de valeur refuge. Choix assumé : plus simple à exécuter, moins de frais, pas de risque de vendre à perte dans la panique.",
        ],
      },
      {
        heading: "L'ADX en filtre de confiance",
        paragraphs: [
          "Au-delà du simple croisement de moyennes, l'ADX indique si la tendance est bien établie (ADX > 25) ou faible/hésitante (ADX < 15). Un signal « INVESTIR » avec un ADX faible mérite plus de prudence qu'un signal avec un ADX fort.",
        ],
      },
      {
        heading: 'Exécution concrète',
        list: [
          'Actif : ETC iShares Physical Gold (ISIN IE00B4ND3602)',
          'Broker : DEGIRO',
          'Montant : 200€/mois (modifiable dans l\'outil)',
          'Fréquence de consultation : une fois par mois suffit',
        ],
      },
    ],
    limitBox: "Le Trend Following ne bat pas nécessairement le simple « buy and hold » en performance brute — sa force est de réduire le risque de gros drawdowns, pas de maximiser le rendement en marché haussier continu. Ce n'est pas une martingale.",
  },

  {
    id: 'behavioral-extremes',
    name: 'Behavioral Extremes',
    color: '#9B7FD4',
    toolLink: 'behavioral-extremes.html',
    toolLinkLabel: 'Ouvrir Behavioral Extremes',
    tagline: 'Contrarian · Crypto liquide · Sur-réactions de foule',
    sections: [
      {
        heading: 'Principe',
        paragraphs: [
          "Cette stratégie ne cherche pas à évaluer la valeur intrinsèque d'un actif — elle cherche à exploiter des biais comportementaux connus : les foules extrapolent trop le passé récent, suivent le mouvement, paniquent ou s'enthousiasment en excès. L'idée : identifier quand un mouvement de prix devient une sur-réaction émotionnelle, attendre un premier signe d'essoufflement, puis parier sur le retour à la normale (contrarian).",
          "C'est une stratégie <strong>sélective par nature</strong> — l'absence de signal est le résultat normal la plupart du temps, pas un problème de l'outil.",
        ],
      },
      {
        heading: 'Sur quoi elle porte',
        paragraphs: [
          "Un panier de 5 cryptos liquides (BTC, ETH, SOL, XRP, DOGE) — l'univers où la participation retail et la réactivité émotionnelle sont les plus visibles.",
        ],
      },
      {
        heading: 'Ce que l\'outil mesure réellement (et ce qu\'il ne mesure PAS)',
        paragraphs: [
          'Le "sentiment" ici est approximé uniquement par des <strong>proxys quantitatifs de prix et de volume</strong> — pas par une vraie analyse de réseaux sociaux, de mentions, ou de NLP sur du texte. Limite assumée, pas un raccourci caché.',
        ],
        list: [
          "<strong>Extension de prix</strong> : distance par rapport à une moyenne mobile de référence",
          '<strong>Volume relatif</strong> : proxy de combien de monde participe au mouvement',
          '<strong>Z-score de volatilité</strong> : proxy de climat émotionnel',
          "<strong>Momentum decay</strong> : le critère central — est-ce que le mouvement récent est nettement plus faible que le précédent ?",
          '<strong>Bougie de rejet</strong> : mèche longue dans le sens opposé à l\'excès',
        ],
      },
      {
        heading: 'Les signaux',
        signalTable: [
          { signal: '▲ REVERSION LONG', cls: 'signal-buy', meaning: 'Prix trop baissé trop vite, panique qui s\'épuise', action: 'Envisager un LONG contrarian' },
          { signal: '▼ REVERSION SHORT', cls: 'signal-sell', meaning: 'Prix trop monté trop vite, euphorie qui s\'épuise', action: 'Envisager un SHORT contrarian' },
          { signal: 'Pas de setup', cls: 'signal-wait', meaning: 'Pas d\'excès, ou excès encore en accélération', action: 'Ne rien faire' },
        ],
      },
      {
        heading: 'Le filtre anti-piège le plus important',
        paragraphs: [
          "Un mouvement encore en pleine accélération n'est <strong>jamais</strong> un setup valide, même avec une extension de prix extrême — parce que ça pourrait être le début d'une vraie tendance forte, pas un excès temporaire. Mieux vaut rater un excès qui continue que de parier contre une vraie tendance naissante.",
        ],
      },
      {
        heading: 'Gestion du risque',
        list: [
          'Stop-loss basé sur l\'ATR (1.5×)',
          'Take-profit à ratio <strong>1.5:1</strong> — plus conservateur que l\'ORB, car un pari contrarian peut voir le momentum reprendre contre toi rapidement',
          'Setup validé seulement à partir de 55/100 au score',
        ],
      },
    ],
    limitBox: "Sans vraie analyse de sentiment social, l'outil ne capture qu'une approximation de la « psychologie de foule » via ce que le prix et le volume laissent deviner. Ça peut rater de vrais excès sentimentaux qui ne se traduisent pas encore en prix/volume, et inversement.",
  },
];
