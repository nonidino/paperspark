// fetch-papers.mjs — build-time prefetch for every source.
//
// None of these sites send CORS headers (and several refuse server-side
// requests entirely), so the browser can't call them directly. We fetch here,
// in CI, and ship the result as static JSON the app loads same-origin: no
// proxies, no CORS, no rate limits at runtime.
//
// Output:
//   data/<source>/<category>.json   papers for one category
//   data/catalog.json               the source -> group -> category tree

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import arxiv from './sources/arxiv.mjs';
import { biorxiv, medrxiv } from './sources/rxiv.mjs';
import nber from './sources/nber.mjs';
import techrxiv from './sources/techrxiv.mjs';
import hfpapers from './sources/hfpapers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const PER_CATEGORY = 30;

const SOURCES = [arxiv, hfpapers, biorxiv, medrxiv, nber, techrxiv];

const log = (msg) => console.log(msg);

/** Strip the "source:" prefix to get the on-disk filename. */
const codeOf = (categoryId) => categoryId.slice(categoryId.indexOf(':') + 1);

async function runSource(source) {
  log(`\n=== ${source.label} ===`);
  const started = Date.now();

  let papers = [];
  let failed = false;
  try {
    papers = await source.fetchAll({ log });
  } catch (err) {
    log(`  SOURCE FAILED (${err.message}) — falling back to cached data`);
    failed = true;
  }

  // Sources that discover their taxonomy while fetching hand it back on _discovered.
  const groups = source.taxonomy(source._discovered || []);

  // Bucket papers into the categories they claim.
  const buckets = new Map();
  for (const group of groups) {
    for (const cat of group.categories) buckets.set(cat.id, []);
  }
  for (const paper of papers) {
    for (const catId of paper.categories) {
      const bucket = buckets.get(catId);
      if (bucket && bucket.length < PER_CATEGORY) bucket.push(stripInternal(paper));
    }
  }

  // Write one file per category, keeping the previous run's papers for any
  // category that is quiet today. Stale papers beat an empty feed.
  const dir = join(DATA_DIR, source.id);
  await mkdir(dir, { recursive: true });

  let written = 0;
  let reused = 0;
  const counts = {};

  for (const [catId, list] of buckets) {
    const file = join(dir, codeOf(catId) + '.json');

    if (list.length > 0) {
      await writeFile(file, JSON.stringify({
        category: catId,
        fetchedAt: new Date().toISOString(),
        papers: list,
      }));
      counts[catId] = list.length;
      written++;
      continue;
    }

    if (existsSync(file)) {
      try {
        const prev = JSON.parse(await readFile(file, 'utf8'));
        const n = prev.papers ? prev.papers.length : 0;
        if (n > 0) {
          counts[catId] = n;
          reused++;
        }
      } catch { /* treat as empty */ }
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  log(`  ${papers.length} papers -> ${written} categories written, ${reused} kept from cache (${secs}s)`);

  return {
    id: source.id,
    label: source.label,
    emoji: source.emoji,
    blurb: source.blurb,
    failed,
    total: papers.length,
    groups: groups
      .map((g) => ({
        ...g,
        categories: g.categories
          .map((c) => ({ ...c, count: counts[c.id] || 0 }))
          .filter((c) => c.count > 0),
      }))
      .filter((g) => g.categories.length > 0),
  };
}

/** Fields used only while fetching shouldn't reach the browser. */
function stripInternal(paper) {
  const { announceType, siteBase, keywords, ...rest } = paper;
  return rest;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const catalogSources = [];
  for (const source of SOURCES) {
    catalogSources.push(await runSource(source));
  }

  const usable = catalogSources.filter((s) => s.groups.length > 0);

  await writeFile(join(DATA_DIR, 'catalog.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    perCategory: PER_CATEGORY,
    sources: usable,
  }, null, 1));

  const totalCats = usable.reduce(
    (sum, s) => sum + s.groups.reduce((n, g) => n + g.categories.length, 0), 0
  );
  log(`\nCatalog: ${usable.length}/${SOURCES.length} sources, ${totalCats} categories with papers.`);

  if (usable.length === 0) {
    console.error('No data from any source — failing so a broken build is not published.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
