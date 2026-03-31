// main.js — PaperSpark: TikTok-style research paper feed

import { fetchRecent, ARXIV_CATEGORIES, getCategoryLabel } from './arxiv.js';
import { generateSummary, getApiKey, setApiKey, removeApiKey, validateApiKey } from './claude.js';
import {
  getSavedCards, toggleSave, isCardSaved, isLiked, isDisliked,
  toggleLike, toggleDislike, getCategories, setCategories,
  getCachedSummary, cacheSummary, hasSeenApiPrompt, markApiPromptSeen,
  clearAllData
} from './storage.js';
import { showToast } from './toast.js';

// --- State ---
let papers = [];          // loaded papers with generated cards
let currentIndex = 0;     // which paper is currently in view
let isLoadingMore = false;
const BUFFER_SIZE = 7;    // pre-load this many papers
const ACCENT_COLORS = ['purple', 'green', 'blue', 'orange', 'pink', 'cyan'];

// --- Init ---
function init() {
  setupNavigation();
  setupSideActions();
  setupApiKeyModal();

  // Show API key prompt if first time
  if (!hasSeenApiPrompt() && !getApiKey()) {
    document.getElementById('api-key-overlay').classList.remove('hidden');
  } else {
    startFeed();
  }
}

async function startFeed() {
  const loading = document.getElementById('loading-overlay');
  loading.classList.remove('hidden');

  try {
    await loadPapers();
    renderAllCards();
    loading.classList.add('hidden');
    document.getElementById('side-actions').classList.remove('hidden');
    updateSideButtons();
  } catch (err) {
    loading.innerHTML = `
      <div class="loading-content">
        <div class="empty-state-emoji">😵</div>
        <div class="empty-state-title">Couldn't load papers</div>
        <p class="empty-state-text">${esc(err.message)}</p>
        <button class="btn btn-primary mt-16" onclick="location.reload()">Retry</button>
      </div>
    `;
  }
}

// --- Paper Loading ---
async function loadPapers(append = false) {
  const cats = getCategories();
  const count = append ? BUFFER_SIZE : BUFFER_SIZE;
  const offset = append ? papers.length : 0;

  const fetched = await fetchRecent(cats, offset + count);
  const newPapers = fetched.slice(offset);

  if (newPapers.length === 0 && !append) {
    throw new Error('No papers found. Try different categories in Settings.');
  }

  for (const p of newPapers) {
    papers.push({
      ...p,
      summary: getCachedSummary(p.arxivId) || null,
      summaryLoading: false,
      summaryError: false,
    });
  }

  // Start generating summaries for new papers (fire & forget)
  if (getApiKey()) {
    for (const p of newPapers) {
      if (!getCachedSummary(p.arxivId)) {
        generateAndCacheSummary(p.arxivId);
      }
    }
  }
}

async function generateAndCacheSummary(arxivId) {
  const idx = papers.findIndex(p => p.arxivId === arxivId);
  if (idx === -1) return;

  const paper = papers[idx];
  if (paper.summary || paper.summaryLoading) return;

  paper.summaryLoading = true;
  updateSummaryUI(arxivId);

  try {
    const summary = await generateSummary(paper);
    paper.summary = summary;
    paper.summaryLoading = false;
    if (summary) cacheSummary(arxivId, summary);
    updateSummaryUI(arxivId);
  } catch (err) {
    paper.summaryLoading = false;
    paper.summaryError = true;
    updateSummaryUI(arxivId);
  }
}

function updateSummaryUI(arxivId) {
  const el = document.querySelector(`.reel-card[data-arxiv-id="${arxivId}"] .summary-slot`);
  if (!el) return;

  const paper = papers.find(p => p.arxivId === arxivId);
  if (!paper) return;

  if (paper.summaryLoading) {
    el.innerHTML = `
      <div class="reel-summary-generating">
        <div class="spinner-sm"></div>
        <span>Generating AI summary...</span>
      </div>
    `;
  } else if (paper.summary) {
    el.innerHTML = `
      <div class="reel-summary">
        <span class="reel-summary-badge">✨ AI Summary</span>
        ${esc(paper.summary)}
      </div>
    `;
  } else if (paper.summaryError) {
    el.innerHTML = `
      <div class="reel-summary-generating" style="color:var(--accent-red)">
        <span>Summary unavailable</span>
      </div>
    `;
  } else if (!getApiKey()) {
    el.innerHTML = `
      <div class="reel-summary-generating">
        <span>Add API key in Settings for AI summaries</span>
      </div>
    `;
  }
}

// --- Render Cards ---
function renderAllCards() {
  const container = document.getElementById('reels-feed');
  container.innerHTML = papers.map((p, i) => renderReelCard(p, i)).join('');

  // Bind scroll for infinite loading + current card tracking
  container.addEventListener('scroll', onScroll, { passive: true });

  // Bind read more buttons
  container.querySelectorAll('.reel-read-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abstractEl = btn.previousElementSibling;
      abstractEl.classList.toggle('expanded');
      btn.textContent = abstractEl.classList.contains('expanded') ? 'Show less' : 'Read more';
    });
  });

  // Update on initial scroll position
  setTimeout(() => updateCurrentIndex(), 100);
}

function renderReelCard(paper, index) {
  const accent = ACCENT_COLORS[index % ACCENT_COLORS.length];
  const cat = paper.categories?.[0] ? getCategoryLabel(paper.categories[0]) : 'Research';
  const date = formatDate(paper.published);
  const authors = formatAuthors(paper.authors);

  let summaryHtml = '';
  if (paper.summary) {
    summaryHtml = `
      <div class="reel-summary">
        <span class="reel-summary-badge">✨ AI Summary</span>
        ${esc(paper.summary)}
      </div>
    `;
  } else if (getApiKey()) {
    summaryHtml = `
      <div class="reel-summary-generating">
        <div class="spinner-sm"></div>
        <span>Generating AI summary...</span>
      </div>
    `;
  } else {
    summaryHtml = `
      <div class="reel-summary-generating">
        <span>Add API key in Settings for AI summaries</span>
      </div>
    `;
  }

  return `
    <div class="reel-card" data-arxiv-id="${paper.arxivId}" data-index="${index}" data-accent="${accent}">
      <div class="reel-bg"></div>
      <div class="reel-content">
        <span class="reel-category">${esc(cat)}</span>
        <h2 class="reel-title">${esc(paper.title)}</h2>
        <div class="reel-meta">
          <span>${esc(authors)}</span>
          <span class="reel-meta-dot"></span>
          <span>${date}</span>
        </div>

        <div class="reel-section">
          <div class="reel-section-header">
            <span class="reel-section-label">Abstract</span>
            <div class="reel-section-line"></div>
          </div>
          <p class="reel-abstract">${esc(paper.abstract)}</p>
          <button class="reel-read-more">Read more</button>
        </div>

        <div class="reel-section">
          <div class="reel-section-header">
            <span class="reel-section-label">AI Summary</span>
            <div class="reel-section-line"></div>
          </div>
          <div class="summary-slot">
            ${summaryHtml}
          </div>
        </div>

        <div class="reel-link-bar">
          <a href="${paper.url}" target="_blank" rel="noopener" class="reel-arxiv-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Read on arXiv
          </a>
          ${paper.pdfUrl ? `
          <a href="${paper.pdfUrl}" target="_blank" rel="noopener" class="reel-arxiv-link">
            PDF
          </a>
          ` : ''}
          <span class="reel-counter">${index + 1} / ${papers.length}</span>
        </div>
      </div>
    </div>
  `;
}

// --- Scroll Handling ---
let scrollTimeout;
function onScroll() {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    updateCurrentIndex();

    // Load more when near the end
    if (currentIndex >= papers.length - 3 && !isLoadingMore) {
      loadMorePapers();
    }
  }, 100);
}

function updateCurrentIndex() {
  const container = document.getElementById('reels-feed');
  const cardHeight = container.firstElementChild?.offsetHeight || 1;
  const newIndex = Math.round(container.scrollTop / cardHeight);

  if (newIndex !== currentIndex) {
    currentIndex = newIndex;
    updateSideButtons();

    // Pre-generate summary for current card if needed
    const paper = papers[currentIndex];
    if (paper && !paper.summary && !paper.summaryLoading && getApiKey()) {
      generateAndCacheSummary(paper.arxivId);
    }
  }
}

async function loadMorePapers() {
  isLoadingMore = true;
  try {
    const prevLen = papers.length;
    await loadPapers(true);

    // Append new cards to DOM
    const container = document.getElementById('reels-feed');
    const newCards = papers.slice(prevLen);
    for (let i = 0; i < newCards.length; i++) {
      const idx = prevLen + i;
      const temp = document.createElement('div');
      temp.innerHTML = renderReelCard(papers[idx], idx);
      const card = temp.firstElementChild;

      // Bind read more
      card.querySelectorAll('.reel-read-more').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const abstractEl = btn.previousElementSibling;
          abstractEl.classList.toggle('expanded');
          btn.textContent = abstractEl.classList.contains('expanded') ? 'Show less' : 'Read more';
        });
      });

      container.appendChild(card);
    }

    // Update counters
    container.querySelectorAll('.reel-counter').forEach((el, i) => {
      el.textContent = `${i + 1} / ${papers.length}`;
    });
  } catch (err) {
    console.error('Failed to load more:', err);
  } finally {
    isLoadingMore = false;
  }
}

// --- Side Action Buttons ---
function setupSideActions() {
  document.getElementById('btn-like').addEventListener('click', () => {
    const paper = papers[currentIndex];
    if (!paper) return;
    const liked = toggleLike(paper.arxivId);
    if (liked) showToast('Liked! ❤️', 'success');
    updateSideButtons();
    animateBtn('btn-like');
  });

  document.getElementById('btn-dislike').addEventListener('click', () => {
    const paper = papers[currentIndex];
    if (!paper) return;
    const disliked = toggleDislike(paper.arxivId);
    if (disliked) {
      showToast('Skipped', 'info');
      // Auto-scroll to next
      scrollToNext();
    }
    updateSideButtons();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    const paper = papers[currentIndex];
    if (!paper) return;
    const saved = toggleSave(paper);
    showToast(saved ? 'Saved! 📚' : 'Removed', saved ? 'success' : 'info');
    updateSideButtons();
    updateSavedBadge();
    animateBtn('btn-save');
  });

  document.getElementById('btn-share').addEventListener('click', () => {
    const paper = papers[currentIndex];
    if (!paper) return;
    if (navigator.share) {
      navigator.share({ title: paper.title, url: paper.url });
    } else {
      navigator.clipboard.writeText(paper.url);
      showToast('Link copied! 🔗', 'success');
    }
  });
}

function updateSideButtons() {
  const paper = papers[currentIndex];
  if (!paper) return;

  const likeBtn = document.getElementById('btn-like');
  const dislikeBtn = document.getElementById('btn-dislike');
  const saveBtn = document.getElementById('btn-save');

  likeBtn.classList.toggle('liked', isLiked(paper.arxivId));
  dislikeBtn.classList.toggle('disliked', isDisliked(paper.arxivId));
  saveBtn.classList.toggle('saved', isCardSaved(paper.arxivId));

  document.getElementById('like-label').textContent = isLiked(paper.arxivId) ? 'Liked' : 'Like';
  document.getElementById('save-label').textContent = isCardSaved(paper.arxivId) ? 'Saved' : 'Save';
}

function scrollToNext() {
  const container = document.getElementById('reels-feed');
  const cardHeight = container.firstElementChild?.offsetHeight || 0;
  container.scrollTo({ top: (currentIndex + 1) * cardHeight, behavior: 'smooth' });
}

function animateBtn(id) {
  const btn = document.getElementById(id);
  btn.classList.add('pop');
  setTimeout(() => btn.classList.remove('pop'), 600);
}

// --- Navigation ---
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;

      // Close if tapping the already active tab (like a toggle)
      if (btn.classList.contains('active') && view !== 'feed') {
        closeAllViews();
        return;
      }

      if (view === 'feed') {
        closeAllViews();
      } else if (view === 'saved') {
        openSavedView();
      } else if (view === 'settings') {
        openSettingsView();
      }

      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('saved-back-btn')?.addEventListener('click', closeAllViews);
  document.getElementById('settings-back-btn')?.addEventListener('click', closeAllViews);

  // Swipe-down to close gestures like native mobile views
  document.querySelectorAll('.page-view').forEach(view => {
    let touchStartY = 0;
    view.addEventListener('touchstart', e => {
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    
    view.addEventListener('touchend', e => {
      const touchEndY = e.changedTouches[0].screenY;
      
      // Look for the scrollable container inside this view
      const content = view.querySelector('.saved-list, .settings-content');
      
      // Only close if the content is scrolled all the way up (or if we swiped on the header where there is no content)
      const isAtTop = !content || content.scrollTop <= 0;

      // If they swiped down more than 70px from the top of the content
      if (isAtTop && (touchEndY - touchStartY > 70)) { 
        closeAllViews();
      }
    }, { passive: true });
  });
}

function closeAllViews() {
  document.getElementById('saved-view').classList.add('hidden');
  document.getElementById('settings-view').classList.add('hidden');
  document.getElementById('side-actions').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('nav-feed').classList.add('active');
}

function openSavedView() {
  document.getElementById('side-actions').classList.add('hidden');
  document.getElementById('settings-view').classList.add('hidden');
  document.getElementById('saved-view').classList.remove('hidden');
  renderSavedList();
}

function openSettingsView() {
  document.getElementById('side-actions').classList.add('hidden');
  document.getElementById('saved-view').classList.add('hidden');
  document.getElementById('settings-view').classList.remove('hidden');
  renderSettings();
}

// --- Saved View ---
function renderSavedList() {
  const container = document.getElementById('saved-list');
  const cards = getSavedCards();

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">📚</div>
        <h3 class="empty-state-title">No saved papers</h3>
        <p class="empty-state-text">Tap the bookmark icon on papers you want to read later</p>
      </div>
    `;
    return;
  }

  container.innerHTML = cards.map(c => `
    <div class="saved-item" data-arxiv-id="${c.arxivId}">
      <div class="saved-item-info">
        <div class="saved-item-title">${esc(c.title)}</div>
        <div class="saved-item-meta">${esc(formatAuthors(c.authors))} · ${formatDate(c.savedAt ? new Date(c.savedAt).toISOString() : c.published)}</div>
      </div>
      <button class="saved-item-unsave" data-arxiv-id="${c.arxivId}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  // Bind events
  container.querySelectorAll('.saved-item-unsave').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.arxivId;
      toggleSave({ arxivId: id });
      showToast('Removed', 'info');
      updateSavedBadge();
      renderSavedList();
    });
  });

  container.querySelectorAll('.saved-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.arxivId;
      const url = `https://arxiv.org/abs/${id}`;
      window.open(url, '_blank');
    });
  });
}

// --- Category Grouping ---
const FIELD_LABELS = {
  cs: '💻 Computer Science',
  econ: '💹 Economics',
  eess: '📶 Electrical Engineering & Systems',
  math: '📐 Mathematics',
  astro: '🔭 Astrophysics',
  'cond-mat': '🧊 Condensed Matter',
  'math-ph': '⚛️ Mathematical Physics',
  nlin: '🌊 Nonlinear Sciences',
  physics: '🔬 Physics',
  'q-bio': '🧬 Quantitative Biology',
  'q-fin': '🏦 Quantitative Finance',
  stat: '📈 Statistics',
};

function renderCategoryGroups() {
  const selected = getCategories();

  // Group categories by field
  const groups = {};
  for (const [key, val] of Object.entries(ARXIV_CATEGORIES)) {
    const field = val.field;
    if (!groups[field]) groups[field] = [];
    groups[field].push({ key, ...val });
  }

  return Object.entries(groups).map(([field, cats]) => {
    const groupSelected = cats.filter(c => selected.includes(c.key)).length;
    const isOpen = groupSelected > 0 || field === 'cs'; // CS open by default

    return `
      <div class="cat-group" data-field="${field}">
        <button class="cat-group-header" data-toggle-field="${field}">
          <span>${FIELD_LABELS[field] || field}</span>
          <span class="cat-group-count">${groupSelected > 0 ? `${groupSelected} selected` : ''}</span>
          <span class="cat-group-chevron ${isOpen ? 'open' : ''}">▸</span>
        </button>
        <div class="cat-group-body ${isOpen ? '' : 'collapsed'}">
          <div class="category-chips">
            ${cats.map(c => `
              <button class="chip ${selected.includes(c.key) ? 'active' : ''}" data-cat="${c.key}">${c.emoji} ${c.label}</button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Settings View ---
function renderSettings() {
  const container = document.getElementById('settings-content');
  const key = getApiKey();
  const masked = key ? '•'.repeat(12) + key.slice(-6) : '';

  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">🔑 Claude API Key</div>
      ${key ? `
        <div class="settings-row">
          <span class="settings-row-value">${masked}</span>
          <button class="btn btn-danger btn-sm" id="settings-remove-key">Remove</button>
        </div>
      ` : `
        <input type="password" class="input-field" id="settings-key-input" placeholder="sk-ant-api03-..." style="margin-bottom:8px">
        <button class="btn btn-primary w-full" id="settings-save-key">Save & Validate</button>
      `}
      <p style="font-size:11px;color:var(--text-muted);margin-top:8px">Key stored locally. Enables AI-generated summaries.</p>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">📡 Research Categories</div>
      <div id="settings-cats">
        ${renderCategoryGroups()}
      </div>
      <button class="btn btn-primary btn-sm w-full mt-8" id="settings-apply-cats">Apply & Reload Feed</button>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">⚠️ Data</div>
      <button class="btn btn-danger w-full" id="settings-clear-data">Clear All Data</button>
    </div>

    <div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:11px">
      PaperSpark — All data stored locally in your browser
    </div>
  `;

  // Bind events
  document.getElementById('settings-remove-key')?.addEventListener('click', () => {
    removeApiKey();
    showToast('Key removed', 'info');
    renderSettings();
  });

  document.getElementById('settings-save-key')?.addEventListener('click', async () => {
    const input = document.getElementById('settings-key-input');
    const val = input.value.trim();
    if (!val) return showToast('Enter a key', 'error');

    const btn = document.getElementById('settings-save-key');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-sm"></div> Validating...';

    const valid = await validateApiKey(val);
    if (valid) {
      setApiKey(val);
      showToast('Key saved! ✅', 'success');
      renderSettings();
      // Generate summaries for current papers
      papers.forEach(p => {
        if (!p.summary && !p.summaryLoading) {
          generateAndCacheSummary(p.arxivId);
        }
      });
    } else {
      showToast('Invalid key', 'error');
      btn.disabled = false;
      btn.textContent = 'Save & Validate';
    }
  });

  document.getElementById('settings-cats')?.addEventListener('click', (e) => {
    // Toggle individual chips
    const chip = e.target.closest('.chip');
    if (chip) { chip.classList.toggle('active'); return; }

    // Toggle group collapse
    const header = e.target.closest('.cat-group-header');
    if (header) {
      const field = header.dataset.toggleField;
      const group = header.closest('.cat-group');
      const body = group?.querySelector('.cat-group-body');
      const chevron = header.querySelector('.cat-group-chevron');
      if (body) body.classList.toggle('collapsed');
      if (chevron) chevron.classList.toggle('open');
    }
  });

  document.getElementById('settings-apply-cats')?.addEventListener('click', () => {
    const active = [...document.querySelectorAll('#settings-cats .chip.active')].map(c => c.dataset.cat);
    if (active.length === 0) return showToast('Select at least one', 'error');
    setCategories(active);
    showToast('Categories updated!', 'success');
    // Reload feed
    papers = [];
    currentIndex = 0;
    closeAllViews();
    startFeed();
  });

  document.getElementById('settings-clear-data')?.addEventListener('click', () => {
    if (!confirm('Delete all saved data?')) return;
    clearAllData();
    showToast('All data cleared', 'info');
    location.reload();
  });
}

// --- API Key Modal ---
function setupApiKeyModal() {
  document.getElementById('api-key-save-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('api-key-input');
    const val = input.value.trim();
    if (!val) { showToast('Enter a key', 'error'); return; }

    const btn = document.getElementById('api-key-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-sm"></div>';

    const valid = await validateApiKey(val);
    if (valid) {
      setApiKey(val);
      markApiPromptSeen();
      document.getElementById('api-key-overlay').classList.add('hidden');
      showToast('API key saved! ✅', 'success');
      startFeed();
    } else {
      showToast('Invalid API key', 'error');
      btn.disabled = false;
      btn.textContent = 'Save Key';
    }
  });

  document.getElementById('api-key-skip-btn')?.addEventListener('click', () => {
    markApiPromptSeen();
    document.getElementById('api-key-overlay').classList.add('hidden');
    startFeed();
  });
}

// --- Badge ---
export function updateSavedBadge() {
  const badge = document.getElementById('saved-badge');
  const count = getSavedCards().length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// --- Helpers ---
function formatAuthors(authors) {
  if (!authors || authors.length === 0) return 'Unknown';
  if (authors.length <= 2) return authors.join(' & ');
  return `${authors[0]} et al.`;
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// Start
init();
