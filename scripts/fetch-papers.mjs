// fetch-papers.mjs — build-time arXiv prefetch.
//
// arXiv's API sends no CORS headers, so the browser cannot call it directly, and
// every free public CORS proxy is now dead, paywalled, or rate-limited by arXiv
// on its shared IPs. Instead we fetch here (in CI, from GitHub's own runners,
// with a polite delay) and ship the result as static JSON that the app loads
// same-origin — no proxy, no CORS, no rate limits at runtime.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARXIV_CATEGORIES } from '../src/arxiv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');

const ARXIV_API = 'https://export.arxiv.org/api/query';
const PER_CATEGORY = 30;    // papers stored per category
const DELAY_MS = 3000;      // arXiv asks for ~3s between requests
// Only ~10 requests per run, so patient retries are cheap insurance against
// arXiv's throttling (backoff goes 9s, 27s, 81s).
const MAX_ATTEMPTS = 4;

// One OR'd query over every category, paged, rather than a request per
// category: ~10 requests instead of ~95. arXiv throttles hard (GitHub's
// runners share IPs with everyone else hitting it), and each extra request is
// another chance to get a 429 and burn minutes on backoff.
const PAGE_SIZE = 200;      // arXiv's practical per-request maximum
const MAX_PAGES = 10;       // 10 x 200 = the 2000 most recent papers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Minimal Atom parsing (Node has no DOMParser; keep this dependency-free) ---

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

// Built with explicit string concatenation rather than template literals so the
// backslashes in the character classes survive verbatim.
function tagRe(tag, flags) {
  return new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', flags);
}

function tagText(xml, tag) {
  const m = xml.match(tagRe(tag));
  return m ? clean(m[1]) : '';
}

function allTagText(xml, tag) {
  const out = [];
  const re = tagRe(tag, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(clean(m[1]));
  return out;
}

// Matches <category term="..."> but deliberately not <arxiv:primary_category ...>
function categoryTerms(xml) {
  const out = [];
  const re = /<category\b[^>]*\bterm="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out;
}

function parseAtom(xml) {
  const papers = [];
  const entryRe = tagRe('entry', 'g');
  let m;

  while ((m = entryRe.exec(xml))) {
    const e = m[1];

    const rawId = tagText(e, 'id');
    const arxivId = rawId
      .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
      .replace(/v\d+$/, '');

    const title = tagText(e, 'title');
    const abstract = tagText(e, 'summary');

    // Skip arXiv's error entries, which come back shaped like real ones.
    if (!arxivId || !title || title === 'Error' || !abstract) continue;

    let pdfUrl = '';
    let absUrl = '';
    const linkRe = /<link\b[^>]*>/g;
    let lm;
    while ((lm = linkRe.exec(e))) {
      const tag = lm[0];
      const href = (tag.match(/href="([^"]*)"/) || [])[1] || '';
      if (/title="pdf"/.test(tag)) pdfUrl = decodeEntities(href);
      if (/type="text\/html"/.test(tag)) absUrl = decodeEntities(href);
    }

    papers.push({
      arxivId,
      title,
      authors: allTagText(e, 'name'),
      abstract,
      categories: categoryTerms(e),
      published: tagText(e, 'published'),
      updated: tagText(e, 'updated'),
      pdfUrl: pdfUrl || 'https://arxiv.org/pdf/' + arxivId,
      url: absUrl || 'https://arxiv.org/abs/' + arxivId,
    });
  }

  return papers;
}

// --- Fetching ---

/**
 * Fetch one page of the combined query. Returns [] when the page is empty,
 * which is how we detect the end of the result set.
 */
async function fetchPage(searchQuery, start) {
  const url = ARXIV_API
    + '?search_query=' + searchQuery
    + '&start=' + start
    + '&max_results=' + PAGE_SIZE
    + '&sortBy=submittedDate&sortOrder=descending';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'PaperSpark/1.0 (+https://github.com/nonidino/paperspark)' },
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return parseAtom(await resp.text());
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      const backoff = DELAY_MS * Math.pow(3, attempt); // 9s, then 27s
      console.log('    retry after ' + err.message + ' (waiting ' + backoff / 1000 + 's)');
      await sleep(backoff);
    }
  }
}

/**
 * Pull the most recent papers across every category in one paged sweep, then
 * bucket them by category. A paper listed under several categories shows up in
 * each of them, which matches what "recent papers in this category" should mean.
 */
async function fetchAllCategories(cats) {
  const searchQuery = cats.map((c) => 'cat:' + c).join('+OR+');
  const buckets = new Map(cats.map((c) => [c, []]));
  const known = new Set(cats);
  const seen = new Set();

  let fetched = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    process.stdout.write('  page ' + (page + 1) + '/' + MAX_PAGES + ' (start=' + start + ') ... ');

    let papers;
    try {
      papers = await fetchPage(searchQuery, start);
    } catch (err) {
      // Keep the pages we already have rather than losing the whole sweep.
      console.log('FAILED (' + err.message + ') — stopping here');
      break;
    }
    console.log(papers.length + ' entries');
    if (papers.length === 0) break;

    for (const paper of papers) {
      if (seen.has(paper.arxivId)) continue;
      seen.add(paper.arxivId);
      fetched++;
      for (const cat of paper.categories) {
        if (!known.has(cat)) continue;
        const bucket = buckets.get(cat);
        if (bucket.length < PER_CATEGORY) bucket.push(paper);
      }
    }

    if (papers.length < PAGE_SIZE) break; // ran past the end of the results
    if (page < MAX_PAGES - 1) await sleep(DELAY_MS);
  }

  console.log('  collected ' + fetched + ' unique papers');
  return buckets;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const cats = Object.keys(ARXIV_CATEGORIES);
  const index = {
    generatedAt: new Date().toISOString(),
    perCategory: PER_CATEGORY,
    categories: {},
  };

  let ok = 0;
  let reused = 0;
  let failed = 0;

  console.log('Fetching ' + cats.length + ' categories in one paged sweep...');

  let buckets;
  try {
    buckets = await fetchAllCategories(cats);
  } catch (err) {
    // Total failure: fall back to whatever the cache holds for every category.
    console.log('Sweep failed (' + err.message + ') — falling back to cached data');
    buckets = new Map(cats.map((c) => [c, []]));
  }

  for (const cat of cats) {
    const file = join(DATA_DIR, cat + '.json');
    const papers = buckets.get(cat) || [];

    if (papers.length > 0) {
      await writeFile(file, JSON.stringify({
        category: cat,
        fetchedAt: new Date().toISOString(),
        papers,
      }));
      index.categories[cat] = papers.length;
      ok++;
      continue;
    }

    // Nothing new for this category — keep the previous run's papers rather
    // than dropping it. Stale papers beat an empty feed.
    if (existsSync(file)) {
      try {
        const prev = JSON.parse(await readFile(file, 'utf8'));
        const n = prev.papers ? prev.papers.length : 0;
        if (n > 0) {
          console.log('  ' + cat + ': no new papers — keeping ' + n + ' cached');
          index.categories[cat] = n;
          reused++;
          continue;
        }
      } catch { /* fall through to the failure path */ }
    }

    console.log('  ' + cat + ': no papers and no cached copy');
    failed++;
  }

  await writeFile(join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log('\nDone: ' + ok + ' fetched, ' + reused + ' kept from cache, ' + failed + ' unavailable.');

  // Only fail the build if we produced essentially nothing.
  if (ok === 0 && reused === 0) {
    console.error('No category data at all — failing so a broken build is not published.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
