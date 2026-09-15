// nber.mjs — NBER working papers.
//
// The RSS carries title, abstract and link but no subject metadata, and NBER
// publishes no per-program feeds, so topics are read off each paper's page.
// Only the "Topics" info-grid block counts: the site's mega-menu links to
// /topics/... too, and those would otherwise be misread as every paper's topics.

import { fetchText, blocks, tagText, toIso, sleep, slugify, BROWSER_UA } from '../lib/common.mjs';

const RSS_URL = 'https://back.nber.org/rss/new.xml';
const DELAY_MS = 1500;

const TOPIC_EMOJI = {
  'macroeconomics': '📉',
  'microeconomics': '🧮',
  'labor-economics': '👷',
  'public-economics': '🏛️',
  'financial-economics': '🏦',
  'international-economics': '🌍',
  'industrial-organization': '🏭',
  'health-education-and-welfare': '🏥',
  'development-and-growth': '📈',
  'environmental-and-resource-economics': '🌱',
  'regional-and-urban-economics': '🏙️',
  'technology-and-innovation': '💡',
  'econometrics': '📊',
  'history': '📜',
  'education': '🎓',
};

/**
 * Pull the paper's own topics out of the "Topics" info-grid block.
 * Returns [{slug, label}].
 */
export function extractTopics(html) {
  // Narrow to the Topics block first so the site navigation can't leak in.
  const start = html.search(/info-grid__item-title[^>]*>\s*Topics\s*</i);
  if (start === -1) return [];

  // The block ends at the next info-grid item title, or a reasonable span.
  const rest = html.slice(start);
  const nextTitle = rest.slice(10).search(/info-grid__item-title/i);
  const body = nextTitle === -1 ? rest.slice(0, 4000) : rest.slice(0, nextTitle + 10);

  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(/<a[^>]*href="\/topics\/([a-z0-9-]+)"[^>]*>([^<]+)<\/a>/g)) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, label: m[2].trim() });
  }
  return out;
}

function parseRss(xml) {
  const papers = [];

  for (const item of blocks(xml, 'item')) {
    const rawTitle = tagText(item, 'title');
    const abstract = tagText(item, 'description');
    const link = (tagText(item, 'link') || '').split('#')[0];
    if (!rawTitle || !link) continue;

    // "Some Title -- by Alice Smith, Bob Jones"
    const [title, byline = ''] = rawTitle.split(/\s+--\s+by\s+/i);
    const authors = byline ? byline.split(/\s*,\s*/).map((a) => a.trim()).filter(Boolean) : [];

    const idMatch = link.match(/\/papers\/(w\d+)/i);
    const paperId = idMatch ? idMatch[1] : link;

    papers.push({
      id: 'nber:' + paperId,
      source: 'nber',
      title: title.trim(),
      authors,
      abstract,
      categories: [],
      published: toIso(tagText(item, 'pubDate')),
      updated: toIso(tagText(item, 'pubDate')),
      pdfUrl: `https://www.nber.org/system/files/working_papers/${paperId}/${paperId}.pdf`,
      url: link,
    });
  }

  return papers;
}

export default {
  id: 'nber',
  label: 'NBER',
  emoji: '🏦',
  blurb: 'Economics & finance working papers',

  // Topics are whatever the fetched papers are tagged with — NBER publishes no
  // machine-readable topic list, so the catalog is built from what we see.
  taxonomy(discovered = []) {
    return [{
      id: '_all',
      label: null,
      categories: discovered.map(({ slug, label }) => ({
        id: 'nber:' + slug,
        label,
        emoji: TOPIC_EMOJI[slug] || '🏦',
        code: slug,
      })),
    }];
  },

  async fetchAll({ log }) {
    const papers = parseRss(await fetchText(RSS_URL, { log }));
    log(`  ${papers.length} papers in feed; reading topics`);

    const discovered = new Map();

    for (const [i, paper] of papers.entries()) {
      try {
        const html = await fetchText(paper.url, { log, ua: BROWSER_UA, attempts: 2 });
        for (const { slug, label } of extractTopics(html)) {
          const key = slugify(slug);
          if (!discovered.has(key)) discovered.set(key, { slug: key, label });
          paper.categories.push('nber:' + key);
        }
      } catch (err) {
        log(`    ${paper.id}: topics unavailable (${err.message})`);
      }
      if (i < papers.length - 1) await sleep(DELAY_MS);
    }

    log(`  discovered ${discovered.size} topics`);

    // Anything with no topic still belongs in the feed.
    const uncategorised = papers.filter((p) => p.categories.length === 0);
    if (uncategorised.length) {
      discovered.set('general', { slug: 'general', label: 'General' });
      uncategorised.forEach((p) => p.categories.push('nber:general'));
    }

    this._discovered = [...discovered.values()].sort((a, b) => a.label.localeCompare(b.label));
    return papers.sort((a, b) => new Date(b.published) - new Date(a.published));
  },
};
