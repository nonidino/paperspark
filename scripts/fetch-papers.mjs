// fetch-papers.mjs — build-time arXiv prefetch.
//
// arXiv sends no CORS headers, so the browser cannot call it directly, and
// every free public CORS proxy is now dead, paywalled, or rate-limited. So we
// fetch here (in CI) and ship the result as static JSON the app loads
// same-origin — no proxy, no CORS, no rate limits at runtime.
//
// Source is rss.arxiv.org, not export.arxiv.org/api: the export API 429s every
// request from GitHub's runners (they share IPs with everyone else polling it),
// while the RSS endpoint is CDN-fronted, meant to be polled, and answers in
// about a second. Categories are requested in "a+b+c" batches, and each item
// carries its own <category> tags, so one response fills many buckets.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARXIV_CATEGORIES } from '../src/arxiv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');

const RSS_BASE = 'https://rss.arxiv.org/rss/';
const PER_CATEGORY = 30;   // papers stored per category
const CHUNK_SIZE = 10;     // categories per request
const DELAY_MS = 2000;     // polite gap between requests
const MAX_ATTEMPTS = 3;
const USER_AGENT = 'PaperSpark/1.0 (+https://github.com/nonidino/paperspark)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Minimal RSS parsing (no DOMParser in Node, no dependencies) ---

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

// Built with string concatenation rather than template literals so the
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

function parseRss(xml) {
  const papers = [];
  const itemRe = tagRe('item', 'g');
  let m;

  while ((m = itemRe.exec(xml))) {
    const item = m[1];

    // guid looks like "oai:arXiv.org:2609.11977v1"
    const guid = tagText(item, 'guid');
    const link = tagText(item, 'link');
    const arxivId = (guid.replace(/^oai:arXiv\.org:/, '')
      || link.replace(/^https?:\/\/arxiv\.org\/abs\//, ''))
      .replace(/v\d+$/, '');

    const title = tagText(item, 'title');

    // description is "arXiv:ID Announce Type: new \nAbstract: <text>"
    const abstract = tagText(item, 'description')
      .replace(/^arXiv:\S+\s*/i, '')
      .replace(/^Announce Type:\s*\S+\s*/i, '')
      .replace(/^Abstract:\s*/i, '')
      .trim();

    if (!arxivId || !title || !abstract) continue;

    const creator = tagText(item, 'dc:creator');
    const authors = creator ? creator.split(/\s*,\s*/).filter(Boolean) : [];

    const pubDate = tagText(item, 'pubDate');
    const published = pubDate && !Number.isNaN(Date.parse(pubDate))
      ? new Date(pubDate).toISOString()
      : new Date().toISOString();

    papers.push({
      arxivId,
      title,
      authors,
      abstract,
      categories: allTagText(item, 'category'),
      published,
      updated: published,
      announceType: tagText(item, 'arxiv:announce_type') || 'new',
      pdfUrl: 'https://arxiv.org/pdf/' + arxivId,
      url: link || 'https://arxiv.org/abs/' + arxivId,
    });
  }

  return papers;
}

// --- Fetching ---

async function fetchChunk(cats) {
  const url = RSS_BASE + cats.join('+');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return parseRss(await resp.text());
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      const backoff = DELAY_MS * Math.pow(3, attempt); // 6s, then 18s
      console.log('    retry after ' + err.message + ' (waiting ' + backoff / 1000 + 's)');
      await sleep(backoff);
    }
  }
}

async function fetchAll(cats) {
  const buckets = new Map(cats.map((c) => [c, []]));
  const known = new Set(cats);
  const seen = new Set();
  const collected = [];

  const chunks = [];
  for (let i = 0; i < cats.length; i += CHUNK_SIZE) {
    chunks.push(cats.slice(i, i + CHUNK_SIZE));
  }

  for (const [i, chunk] of chunks.entries()) {
    process.stdout.write('[' + (i + 1) + '/' + chunks.length + '] ' + chunk.join('+') + ' ... ');
    try {
      const papers = await fetchChunk(chunk);
      console.log(papers.length + ' items');
      for (const paper of papers) {
        if (seen.has(paper.arxivId)) continue;
        seen.add(paper.arxivId);
        collected.push(paper);
      }
    } catch (err) {
      // Keep going: other chunks still contribute, and unfilled categories
      // fall back to their cached copy below.
      console.log('FAILED (' + err.message + ')');
    }

    if (i < chunks.length - 1) await sleep(DELAY_MS);
  }

  // Newly announced papers first, revisions of older ones last, so a category
  // fills up with genuinely new work before falling back to replacements.
  const rank = (p) => (p.announceType === 'replace' ? 1 : 0);
  collected.sort((a, b) => rank(a) - rank(b) || new Date(b.published) - new Date(a.published));

  for (const paper of collected) {
    for (const cat of paper.categories) {
      if (!known.has(cat)) continue;
      const bucket = buckets.get(cat);
      if (bucket.length < PER_CATEGORY) {
        const { announceType, ...rest } = paper;
        bucket.push(rest);
      }
    }
  }

  console.log('Collected ' + collected.length + ' unique papers.');
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

  const buckets = await fetchAll(cats);

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

    // Nothing announced for this category today — keep the previous run's
    // papers rather than dropping it. Stale papers beat an empty feed.
    if (existsSync(file)) {
      try {
        const prev = JSON.parse(await readFile(file, 'utf8'));
        const n = prev.papers ? prev.papers.length : 0;
        if (n > 0) {
          index.categories[cat] = n;
          reused++;
          continue;
        }
      } catch { /* fall through to the failure path */ }
    }

    failed++;
  }

  await writeFile(join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log('\nDone: ' + ok + ' fetched, ' + reused + ' kept from cache, ' + failed + ' empty.');

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
