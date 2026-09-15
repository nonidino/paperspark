// feed.js — loads papers for the categories the reader has selected.
//
// Every source is prefetched into static JSON at build time, so this is a
// same-origin read: no CORS, no proxies, no rate limits. Papers from different
// sources are interleaved by date so the feed reads as one stream.

import { splitCategoryId, normalizeCategoryId } from './catalog.js';

const DATA_BASE = new URL('../data/', import.meta.url);
const FETCH_TIMEOUT_MS = 8000;

// Per-category memo, so paging to the end of the feed doesn't refetch on
// every scroll tick.
const cache = new Map();

function fetchCategory(categoryId) {
  if (!cache.has(categoryId)) {
    // Don't memoize an empty result — a transient failure should be retryable.
    const pending = loadCategory(categoryId).then((papers) => {
      if (papers.length === 0) cache.delete(categoryId);
      return papers;
    });
    cache.set(categoryId, pending);
  }
  return cache.get(categoryId);
}

async function loadCategory(categoryId) {
  const { sourceId, code } = splitCategoryId(categoryId);
  try {
    const url = new URL(`${sourceId}/${encodeURIComponent(code)}.json`, DATA_BASE);
    const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data?.papers) ? data.papers : [];
  } catch {
    return [];
  }
}

/**
 * Fetch recent papers across the selected categories, blended across sources.
 *
 * Sorting the pool purely by date would let one source dominate — NBER stamps
 * everything with the announcement date, so it buries a week of arXiv — so
 * papers are taken round-robin from each source, newest first within each.
 */
export async function fetchRecent(categoryIds = [], maxResults = 10) {
  const ids = (categoryIds.length ? categoryIds : ['arxiv:cs.AI']).map(normalizeCategoryId);
  const selected = new Set(ids);

  const lists = await Promise.all(ids.map(fetchCategory));

  const seen = new Set();
  const bySource = new Map();

  for (const paper of lists.flat()) {
    const id = paper?.id || (paper?.arxivId ? `arxiv:${paper.arxivId}` : null);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const source = paper.source || 'arxiv';
    // Label the card with a category the reader actually asked for, not
    // whichever one the paper happens to list first.
    const primaryCategory =
      (paper.categories || []).find((c) => selected.has(c)) || (paper.categories || [])[0];

    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push({ ...paper, id, source, primaryCategory });
  }

  for (const list of bySource.values()) {
    list.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  }

  // Round-robin, so every selected source shows up near the top of the feed.
  const queues = [...bySource.values()];
  const out = [];
  for (let round = 0; out.length < maxResults; round++) {
    let added = false;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      out.push(queue[round]);
      added = true;
      if (out.length >= maxResults) break;
    }
    if (!added) break;
  }

  return out;
}
