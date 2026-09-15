// catalog.js — the source → group → category tree the picker renders from.
//
// Generated at build time by scripts/fetch-papers.mjs and served from this
// site's own origin, so it always matches the papers that actually shipped:
// a category only appears if it has papers behind it.

const DATA_BASE = new URL('../data/', import.meta.url);
const FETCH_TIMEOUT_MS = 8000;

let catalogPromise = null;

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(new URL('catalog.json', DATA_BASE), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => (c && Array.isArray(c.sources) ? c : { sources: [] }))
      .catch(() => {
        catalogPromise = null; // a transient failure should be retryable
        return { sources: [] };
      });
  }
  return catalogPromise;
}

/** Every category in the catalog, flattened, keyed by id. */
export async function categoryIndex() {
  const catalog = await loadCatalog();
  const index = new Map();
  for (const source of catalog.sources) {
    for (const group of source.groups) {
      for (const cat of group.categories) {
        index.set(cat.id, { ...cat, source, group });
      }
    }
  }
  return index;
}

/** Split "arxiv:cs.AI" into its source id and on-disk code. */
export function splitCategoryId(categoryId) {
  const i = categoryId.indexOf(':');
  if (i === -1) return { sourceId: 'arxiv', code: categoryId };
  return { sourceId: categoryId.slice(0, i), code: categoryId.slice(i + 1) };
}

/**
 * Categories saved before multi-source support were bare arXiv codes
 * ("cs.AI"); treat those as arXiv.
 */
export function normalizeCategoryId(categoryId) {
  return categoryId.includes(':') ? categoryId : `arxiv:${categoryId}`;
}

export async function getSourceMeta(sourceId) {
  const catalog = await loadCatalog();
  return catalog.sources.find((s) => s.id === sourceId) || null;
}
