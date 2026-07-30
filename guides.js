// ============================================================
// GUIDES — rendu générique à partir de STRATEGY_GUIDES (guides-data.js)
// Ajouter une stratégie = ajouter une entrée dans guides-data.js, rien à
// changer ici.
// ============================================================

const els = {
  tabsContainer: document.getElementById('strategy-tabs'),
  contentContainer: document.getElementById('guide-content'),
};

let activeId = STRATEGY_GUIDES.length > 0 ? STRATEGY_GUIDES[0].id : null;

renderTabs();
renderContent();

function renderTabs() {
  els.tabsContainer.innerHTML = STRATEGY_GUIDES.map(g => `
    <button class="strategy-tab ${g.id === activeId ? 'active' : ''}"
            data-id="${g.id}"
            style="${g.id === activeId ? `background:${g.color}; border-color:${g.color};` : ''}">
      <span class="dot" style="background:${g.color};"></span>
      ${escapeHtml(g.name)}
    </button>
  `).join('');

  els.tabsContainer.querySelectorAll('.strategy-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeId = btn.dataset.id;
      renderTabs();
      renderContent();
    });
  });
}

function renderContent() {
  const guide = STRATEGY_GUIDES.find(g => g.id === activeId);
  if (!guide) {
    els.contentContainer.innerHTML = '<p style="color:var(--text-dim);">Aucun guide disponible.</p>';
    return;
  }

  const sectionsHtml = guide.sections.map(s => `
    <h2>${escapeHtml(s.heading)}</h2>
    ${(s.paragraphs || []).map(p => `<p>${p}</p>`).join('')}
    ${s.list ? `<ul>${s.list.map(item => `<li>${item}</li>`).join('')}</ul>` : ''}
    ${s.signalTable ? renderSignalTable(s.signalTable) : ''}
  `).join('');

  els.contentContainer.innerHTML = `
    <h1>${escapeHtml(guide.name)}</h1>
    <div class="guide-tagline">${escapeHtml(guide.tagline)}</div>
    ${sectionsHtml}
    ${guide.limitBox ? `<div class="limit-box"><strong>Limite honnête à garder en tête —</strong> ${guide.limitBox}</div>` : ''}
    <a href="${guide.toolLink}" class="link-to-tool">→ ${escapeHtml(guide.toolLinkLabel)}</a>
  `;
}

function renderSignalTable(rows) {
  return `
    <table class="signal-table">
      <thead><tr><th>Signal</th><th>Signification</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="signal-cell ${r.cls}">${escapeHtml(r.signal)}</td>
            <td>${escapeHtml(r.meaning)}</td>
            <td>${escapeHtml(r.action)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
