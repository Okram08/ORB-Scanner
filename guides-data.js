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

  {
    id: 'turtle-trading',
    name: 'Turtle Trading',
    color: '#5FA8A0',
    toolLink: 'turtle-trading.html',
    toolLinkLabel: 'Ouvrir Turtle Trading',
    tagline: 'Long terme · Multi-marchés · Donchian breakout (1983)',
    sections: [
      {
        heading: 'Principe',
        paragraphs: [
          "Stratégie historique créée par Richard Dennis et William Eckhardt en 1983 : un système de trend following 100% mécanique, sans prédiction — <strong>« la tendance est ton amie »</strong>. On achète la force, on vend la faiblesse, et on laisse courir les gagnants jusqu'à un vrai signal de retournement. C'est l'expérience qui a prouvé qu'un système de trading peut être enseigné à des débutants avec des règles strictes.",
          "C'est une stratégie <strong>long terme</strong> (semaines à mois), appliquée en parallèle sur plusieurs marchés — l'esprit original tradait matières premières, devises, obligations et indices simultanément, pas un seul actif.",
        ],
      },
      {
        heading: 'Le canal Donchian',
        paragraphs: [
          "Le signal d'entrée repose sur le canal Donchian — le plus haut et le plus bas des N derniers jours. Deux systèmes tournent en parallèle :",
        ],
        list: [
          '<strong>Système 1 (20 jours)</strong> : entrée sur cassure du plus haut/bas des 20 derniers jours — mais le signal est <strong>ignoré</strong> si le breakout précédent dans le même sens était déjà gagnant (règle anti-faux-signaux)',
          '<strong>Système 2 (55 jours)</strong> : entrée sur cassure à 55 jours, toujours suivi sans exception — sert de filet si le Système 1 est filtré',
        ],
      },
      {
        heading: 'Les signaux',
        signalTable: [
          { signal: '▲ LONG (Système 1 ou 2)', cls: 'signal-buy', meaning: 'Cassure du plus haut sur 20j (ou 55j)', action: 'Envisager un LONG' },
          { signal: '▼ SHORT (Système 1 ou 2)', cls: 'signal-sell', meaning: 'Cassure du plus bas sur 20j (ou 55j)', action: 'Envisager un SHORT' },
          { signal: 'Pas de cassure', cls: 'signal-wait', meaning: 'Prix encore dans le canal', action: 'Ne rien faire' },
        ],
      },
      {
        heading: 'N — la mesure de volatilité (ATR)',
        paragraphs: [
          "N (l'ATR sur 20 jours) est le cœur du système : il sert à la fois au stop-loss et au dimensionnement de position, pour que le risque soit toujours comparable en % du portefeuille peu importe la volatilité propre de chaque marché.",
        ],
      },
      {
        heading: 'Sortie — pas de take-profit fixe',
        paragraphs: [
          "Contrairement à l'ORB ou Behavioral Extremes, Turtle Trading <strong>n'a pas de take-profit fixe</strong>. La sortie se fait sur le PREMIER des deux niveaux touchés :",
        ],
        list: [
          '<strong>Stop-loss à 2N</strong> : si le trade tourne mal rapidement',
          '<strong>Sortie de tendance</strong> (cassure Donchian inverse à 10j pour le Système 1, 20j pour le Système 2) : si le mouvement s\'essouffle après avoir été gagnant',
        ],
      },
      {
        heading: 'Philosophie de sortie',
        paragraphs: ["Laisser courir les gagnants aussi longtemps que la tendance tient, quitte à rendre une partie des gains avant que le signal de sortie ne se déclenche."],
      },
    ],
    limitBox: "Le système accepte de nombreuses petites pertes (marché en range, faux signaux) — c'est structurel, pas un défaut. Sa rentabilité vient de rares mais grands gagnants qui compensent largement les pertes fréquentes. La discipline (suivre toutes les règles sans exception) compte plus que la qualité perçue d'un signal individuel.",
  },

  {
    id: 'london-breakout',
    name: 'London Breakout',
    color: '#6B8CBE',
    toolLink: 'london-breakout.html',
    toolLinkLabel: 'Ouvrir London Breakout',
    tagline: 'Day trading · EUR/USD · Session Londres',
    sections: [
      {
        heading: 'Principe',
        paragraphs: [
          "La session asiatique (00h–08h GMT) est structurellement calme sur EUR/USD — les gros acteurs européens et américains sont hors ligne, donc le prix compresse dans un range étroit par faible participation. L'ouverture de Londres (qui concentre à elle seule environ 38% du volume mondial de change) fait souvent exploser ce range avec conviction dès son ouverture.",
          "C'est une stratégie de <strong>day trading</strong> — horizon max 24h, pas une position tenue plusieurs jours.",
        ],
      },
      {
        heading: "L'espérance mathématique, pas le taux de réussite",
        paragraphs: [
          "Un point important : cette stratégie ne vise <strong>pas</strong> un taux de réussite élevé. Un calcul documenté sur cette approche donne un winrate autour de 41.5%, compensé par un ratio risque/reward de 2:1 — l'espérance mathématique reste positive malgré une majorité de trades perdants, exactement comme pour l'ORB.",
        ],
      },
      {
        heading: 'Les signaux',
        signalTable: [
          { signal: '▲ BREAKOUT HAUSSIER', cls: 'signal-buy', meaning: "Cassure de l'Asian High confirmée par clôture + impulsion", action: 'Envisager un LONG' },
          { signal: '▼ BREAKOUT BAISSIER', cls: 'signal-sell', meaning: "Cassure de l'Asian Low confirmée par clôture + impulsion", action: 'Envisager un SHORT' },
          { signal: '— PAS DE SIGNAL', cls: 'signal-wait', meaning: 'Pas de cassure, ou cassure invalidée (fakeout)', action: 'Ne rien faire' },
        ],
      },
      {
        heading: 'Le filtre de compression',
        paragraphs: [
          "Le critère central : le range asiatique doit être <strong>compressé</strong> (inférieur à 35% de l'ATR14 journalier) avant la cassure. Un range déjà large avant l'ouverture de Londres n'a pas le même potentiel d'expansion — l'edge documenté repose spécifiquement sur le pattern « compression puis explosion ».",
        ],
      },
      {
        heading: 'Anti-fakeout',
        paragraphs: [
          "Deux filtres se cumulent pour éviter les faux signaux : la cassure doit être confirmée par une <strong>clôture</strong> de bougie hors du range (pas juste une mèche), et la bougie de cassure doit avoir un <strong>corps significatif</strong> (au moins 50% du range de la bougie) — un signe d'impulsion réelle plutôt qu'un simple dépassement passager.",
        ],
      },
      {
        heading: 'Fenêtre de trading',
        list: [
          '<strong>00h–07h GMT</strong> : le range asiatique se forme, pas de signal encore',
          '<strong>07h–12h GMT</strong> : fenêtre utile, tu analyses et agis si un signal net apparaît',
          "<strong>Après 12h GMT</strong> : l'edge du breakout matinal s'estompe",
        ],
      },
      {
        heading: 'Gestion du risque',
        list: [
          "Stop-loss : opposé du range asiatique, plafonné à 1.5× ATR",
          'Take-profit : ratio 2:1',
          'Position non résolue après 24h : clôture manuelle recommandée',
        ],
      },
    ],
    limitBox: "Le volume forex n'étant pas fiable sur Yahoo Finance, ce score ne peut pas s'appuyer sur le volume comme les autres stratégies — il repose uniquement sur la compression du range, l'ADX, et la qualité structurelle de la cassure. Les seuils (35% de compression, 50% de corps de bougie) sont des valeurs de départ raisonnables, pas des paramètres optimisés sur un vrai historique massif — à affiner avec ton propre suivi.",
  },
];
