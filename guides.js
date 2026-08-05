// ============================================================
// GUIDES-DATA — contenu du guide de stratégie.
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
    limitBox: "Aucun de ces critères n'a été validé par un vrai backtest massif au départ — c'est construit sur des règles ORB reconnues, pas sur des milliers de trades historiques analysés. Le journal de suivi et le calendrier Portfolio sont là pour vérifier, avec tes propres données, si le système fonctionne réellement pour toi.",
  },
];
