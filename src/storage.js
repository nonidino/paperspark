// storage.js — localStorage for saved cards, preferences, summaries cache

const KEYS = {
  savedCards: 'ps_saved',
  likedIds: 'ps_liked',
  dislikedIds: 'ps_disliked',
  categories: 'ps_categories',
  summaryCache: 'ps_summaries',
  hasSeenApiPrompt: 'ps_seen_api_prompt',
};

// Before multiple sources, everything was keyed by a bare arXiv id ("2609.01234")
// and categories were bare codes ("cs.AI"). Both are now namespaced by source.
const asPaperId = (value) => (String(value).includes(':') ? String(value) : `arxiv:${value}`);

/** One-time upgrade of anything stored under the old arXiv-only scheme. */
export function migrateLegacyStorage() {
  try {
    const cards = JSON.parse(localStorage.getItem(KEYS.savedCards) || '[]');
    let changed = false;
    for (const card of cards) {
      if (!card.paperId) {
        card.paperId = asPaperId(card.arxivId || card.id);
        card.source = card.source || 'arxiv';
        changed = true;
      }
    }
    if (changed) localStorage.setItem(KEYS.savedCards, JSON.stringify(cards));

    for (const key of [KEYS.likedIds, KEYS.dislikedIds]) {
      const ids = JSON.parse(localStorage.getItem(key) || '[]');
      if (ids.some((id) => !String(id).includes(':'))) {
        localStorage.setItem(key, JSON.stringify(ids.map(asPaperId)));
      }
    }

    const cats = JSON.parse(localStorage.getItem(KEYS.categories) || 'null');
    if (Array.isArray(cats) && cats.some((c) => !String(c).includes(':'))) {
      localStorage.setItem(KEYS.categories, JSON.stringify(cats.map(asPaperId)));
    }
  } catch { /* corrupt storage shouldn't stop the app booting */ }
}

// --- Saved Cards ---
export function getSavedCards() {
  try { return JSON.parse(localStorage.getItem(KEYS.savedCards) || '[]'); }
  catch { return []; }
}

export function saveCard(data) {
  const paperId = asPaperId(data.paperId || data.id || data.arxivId);
  const cards = getSavedCards();
  if (cards.some(c => c.paperId === paperId)) return;
  cards.unshift({ ...data, paperId, savedAt: Date.now() });
  localStorage.setItem(KEYS.savedCards, JSON.stringify(cards));
}

export function removeSavedCard(paperId) {
  const cards = getSavedCards().filter(c => c.paperId !== paperId);
  localStorage.setItem(KEYS.savedCards, JSON.stringify(cards));
}

export function updateSavedCardNote(paperId, note) {
  const cards = getSavedCards();
  const index = cards.findIndex(c => c.paperId === paperId);
  if (index !== -1) {
    cards[index].note = note;
    localStorage.setItem(KEYS.savedCards, JSON.stringify(cards));
  }
}

export function isCardSaved(paperId) {
  return getSavedCards().some(c => c.paperId === paperId);
}

export function toggleSave(data) {
  const paperId = asPaperId(data.paperId || data.id || data.arxivId);
  if (isCardSaved(paperId)) {
    removeSavedCard(paperId);
    return false;
  }
  saveCard(data);
  return true;
}

// --- Likes / Dislikes ---
function getSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch { return new Set(); }
}

function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

export function isLiked(id) { return getSet(KEYS.likedIds).has(id); }
export function isDisliked(id) { return getSet(KEYS.dislikedIds).has(id); }

export function toggleLike(id) {
  const liked = getSet(KEYS.likedIds);
  const disliked = getSet(KEYS.dislikedIds);
  disliked.delete(id);
  const nowLiked = !liked.has(id);
  nowLiked ? liked.add(id) : liked.delete(id);
  saveSet(KEYS.likedIds, liked);
  saveSet(KEYS.dislikedIds, disliked);
  return nowLiked;
}

export function toggleDislike(id) {
  const liked = getSet(KEYS.likedIds);
  const disliked = getSet(KEYS.dislikedIds);
  liked.delete(id);
  const nowDisliked = !disliked.has(id);
  nowDisliked ? disliked.add(id) : disliked.delete(id);
  saveSet(KEYS.likedIds, liked);
  saveSet(KEYS.dislikedIds, disliked);
  return nowDisliked;
}

// --- Categories ---
const DEFAULT_CATEGORIES = ['arxiv:cs.AI', 'arxiv:cs.LG', 'arxiv:cs.CL'];

export function getCategories() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEYS.categories) || 'null');
    if (!Array.isArray(stored) || stored.length === 0) return [...DEFAULT_CATEGORIES];
    return stored.map(asPaperId);
  } catch { return [...DEFAULT_CATEGORIES]; }
}

export function setCategories(cats) {
  localStorage.setItem(KEYS.categories, JSON.stringify(cats));
}

// --- Summary Cache ---
export function getCachedSummary(arxivId) {
  try {
    const cache = JSON.parse(localStorage.getItem(KEYS.summaryCache) || '{}');
    return cache[arxivId] || null;
  } catch { return null; }
}

export function cacheSummary(arxivId, summary) {
  try {
    const cache = JSON.parse(localStorage.getItem(KEYS.summaryCache) || '{}');
    cache[arxivId] = summary;
    // Keep cache to 200 entries max
    const keys = Object.keys(cache);
    if (keys.length > 200) {
      keys.slice(0, keys.length - 200).forEach(k => delete cache[k]);
    }
    localStorage.setItem(KEYS.summaryCache, JSON.stringify(cache));
  } catch {}
}

// --- API prompt flag ---
export function hasSeenApiPrompt() {
  return localStorage.getItem(KEYS.hasSeenApiPrompt) === '1';
}

export function markApiPromptSeen() {
  localStorage.setItem(KEYS.hasSeenApiPrompt, '1');
}

// --- Data management ---
export function clearAllData() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}
