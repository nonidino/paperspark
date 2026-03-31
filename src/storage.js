// storage.js — localStorage for saved cards, preferences, summaries cache

const KEYS = {
  savedCards: 'ps_saved',
  likedIds: 'ps_liked',
  dislikedIds: 'ps_disliked',
  categories: 'ps_categories',
  summaryCache: 'ps_summaries',
  hasSeenApiPrompt: 'ps_seen_api_prompt',
};

// --- Saved Cards ---
export function getSavedCards() {
  try { return JSON.parse(localStorage.getItem(KEYS.savedCards) || '[]'); }
  catch { return []; }
}

export function saveCard(data) {
  const cards = getSavedCards();
  if (cards.find(c => c.arxivId === data.arxivId)) return;
  cards.unshift({ ...data, id: crypto.randomUUID(), savedAt: Date.now() });
  localStorage.setItem(KEYS.savedCards, JSON.stringify(cards));
}

export function removeSavedCard(arxivId) {
  const cards = getSavedCards().filter(c => c.arxivId !== arxivId);
  localStorage.setItem(KEYS.savedCards, JSON.stringify(cards));
}

export function isCardSaved(arxivId) {
  return getSavedCards().some(c => c.arxivId === arxivId);
}

export function toggleSave(data) {
  if (isCardSaved(data.arxivId)) {
    removeSavedCard(data.arxivId);
    return false;
  } else {
    saveCard(data);
    return true;
  }
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
export function getCategories() {
  try { return JSON.parse(localStorage.getItem(KEYS.categories) || '["cs.AI","cs.LG","cs.CL"]'); }
  catch { return ['cs.AI', 'cs.LG', 'cs.CL']; }
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
