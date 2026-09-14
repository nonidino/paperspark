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
const MAX_ATTEMPTS = 3;

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

async function fetchCategory(cat) {
  const url = ARXIV_API
    + '?search_query=cat:' + encodeURIComponent(cat)
    + '&max_results=' + PER_CATEGORY
    + '&sortBy=submittedDate&sortOrder=descending';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'PaperSpark/1.0 (+https://github.com/nonidino/paperspark)' },
        signal: AbortSignal.timeout(45000),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const papers = parseAtom(await resp.text());
      if (papers.length === 0) throw new Error('no entries parsed');
      return papers;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      const backoff = DELAY_MS * Math.pow(3, attempt); // 9s, then 27s
      console.log('    retry after ' + err.message + ' (waiting ' + backoff / 1000 + 's)');
      await sleep(backoff);
    }
  }
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

  for (const [i, cat] of cats.entries()) {
    const file = join(DATA_DIR, cat + '.json');
    process.stdout.write('[' + (i + 1) + '/' + cats.length + '] ' + cat + ' ... ');

    try {
      const papers = await fetchCategory(cat);
      await writeFile(file, JSON.stringify({
        category: cat,
        fetchedAt: new Date().toISOString(),
        papers,
      }));
      console.log(papers.length + ' papers');
      index.categories[cat] = papers.length;
      ok++;
    } catch (err) {
      // Keep whatever a previous (cached) run stored rather than dropping the
      // category entirely — stale papers beat an empty feed.
      let kept = false;
      if (existsSync(file)) {
        try {
          const prev = JSON.parse(await readFile(file, 'utf8'));
          const n = prev.papers ? prev.papers.length : 0;
          console.log('FAILED (' + err.message + ') — keeping ' + n + ' cached');
          index.categories[cat] = n;
          reused++;
          kept = true;
        } catch { /* fall through to the failure path */ }
      }
      if (!kept) {
        console.log('FAILED (' + err.message + ') — no cached copy');
        failed++;
      }
    }

    if (i < cats.length - 1) await sleep(DELAY_MS);
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
