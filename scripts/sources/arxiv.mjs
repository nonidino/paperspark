// arxiv.mjs — arXiv via rss.arxiv.org.
//
// Not export.arxiv.org/api: that 429s every request from GitHub's runners.
// The RSS endpoint is CDN-fronted, meant to be polled, accepts "cat1+cat2+..."
// batches, and tags each item with all of its categories.

import { ARXIV_CATEGORIES, ARXIV_GROUPS } from '../../src/arxiv.js';
import { fetchText, blocks, tagText, allTagText, toIso, sleep } from '../lib/common.mjs';

const RSS_BASE = 'https://rss.arxiv.org/rss/';
const CHUNK_SIZE = 10;
const DELAY_MS = 2000;

function parseRss(xml) {
  const papers = [];

  for (const item of blocks(xml, 'item')) {
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
    const published = toIso(tagText(item, 'pubDate'));

    papers.push({
      id: 'arxiv:' + arxivId,
      arxivId,
      source: 'arxiv',
      title,
      authors: creator ? creator.split(/\s*,\s*/).filter(Boolean) : [],
      abstract,
      categories: allTagText(item, 'category')
        .filter((c) => ARXIV_CATEGORIES[c])
        .map((c) => 'arxiv:' + c),
      published,
      updated: published,
      announceType: tagText(item, 'arxiv:announce_type') || 'new',
      pdfUrl: 'https://arxiv.org/pdf/' + arxivId,
      url: link || 'https://arxiv.org/abs/' + arxivId,
    });
  }

  return papers;
}

export default {
  id: 'arxiv',
  label: 'arXiv',
  emoji: '📄',
  blurb: 'Physics, maths, CS, economics and more',

  /** Groups are static here — arXiv's taxonomy is known, not discovered. */
  taxonomy() {
    const groups = Object.entries(ARXIV_GROUPS).map(([groupId, meta]) => ({
      id: groupId,
      label: meta.label,
      emoji: meta.emoji,
      categories: Object.entries(ARXIV_CATEGORIES)
        .filter(([, c]) => c.group === groupId)
        .map(([key, c]) => ({ id: 'arxiv:' + key, label: c.label, emoji: c.emoji, code: key })),
    }));
    return groups;
  },

  async fetchAll({ log }) {
    const cats = Object.keys(ARXIV_CATEGORIES);
    const chunks = [];
    for (let i = 0; i < cats.length; i += CHUNK_SIZE) chunks.push(cats.slice(i, i + CHUNK_SIZE));

    const seen = new Set();
    const collected = [];

    for (const [i, chunk] of chunks.entries()) {
      log(`  [${i + 1}/${chunks.length}] ${chunk[0]}…${chunk[chunk.length - 1]}`);
      try {
        for (const paper of parseRss(await fetchText(RSS_BASE + chunk.join('+'), { log }))) {
          if (seen.has(paper.id)) continue;
          seen.add(paper.id);
          collected.push(paper);
        }
      } catch (err) {
        log(`    FAILED (${err.message})`);
      }
      if (i < chunks.length - 1) await sleep(DELAY_MS);
    }

    // Newly announced first, revisions of older papers last.
    const rank = (p) => (p.announceType === 'replace' ? 1 : 0);
    collected.sort((a, b) => rank(a) - rank(b) || new Date(b.published) - new Date(a.published));
    collected.forEach((p) => delete p.announceType);

    return collected;
  },
};
