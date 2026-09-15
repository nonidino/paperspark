// techrxiv.mjs — TechRxiv (IEEE's engineering preprint server).
//
// techrxiv.org itself sits behind a Cloudflare challenge that refuses
// server-side requests, so content comes from Crossref by DOI prefix, which
// carries the abstracts. Crossref has no subject terms for these, so the
// categories come from OpenAlex's topic field, looked up in batches by DOI.

import { fetchJson, clean, toIso, sleep, slugify } from '../lib/common.mjs';

const CROSSREF = 'https://api.crossref.org/prefixes/10.36227/works';
const OPENALEX = 'https://api.openalex.org/works';
const MAILTO = 'nonidino@gmail.com';

const ROWS = 100;        // recent works to pull from Crossref
const OA_BATCH = 25;     // DOIs per OpenAlex lookup
const DELAY_MS = 1200;

const FIELD_EMOJI = {
  engineering: '⚙️',
  'computer-science': '💻',
  medicine: '🩺',
  'physics-and-astronomy': '🔭',
  'materials-science': '🧱',
  mathematics: '📐',
  'energy': '⚡',
  'environmental-science': '🌍',
  'social-sciences': '👥',
  'business-management-and-accounting': '💼',
  'decision-sciences': '🎯',
  'chemistry': '🧪',
  'chemical-engineering': '⚗️',
  'biochemistry-genetics-and-molecular-biology': '🧬',
  'agricultural-and-biological-sciences': '🌾',
  'earth-and-planetary-sciences': '🪨',
  'neuroscience': '🧠',
  'health-professions': '🏥',
  'economics-econometrics-and-finance': '💹',
  'psychology': '🧠',
  'nursing': '🧑‍⚕️',
  'pharmacology-toxicology-and-pharmaceutics': '💊',
  'immunology-and-microbiology': '🦠',
  'veterinary': '🐾',
  'dentistry': '🦷',
  'arts-and-humanities': '🎭',
};

function parseCrossref(items) {
  const papers = [];

  for (const it of items) {
    const doi = it.DOI;
    const title = clean((it.title || [])[0] || '');
    const abstract = clean(it.abstract || '');
    if (!doi || !title || !abstract) continue;

    const authors = (it.author || [])
      .map((a) => [a.given, a.family].filter(Boolean).join(' ').trim())
      .filter(Boolean);

    const posted = it.posted || it.created || it.issued;
    const parts = posted?.['date-parts']?.[0];
    const published = parts
      ? toIso(`${parts[0]}-${String(parts[1] || 1).padStart(2, '0')}-${String(parts[2] || 1).padStart(2, '0')}`)
      : toIso(posted?.['date-time']);

    papers.push({
      id: 'techrxiv:' + doi,
      doi,
      source: 'techrxiv',
      title,
      authors,
      abstract,
      categories: [],
      published,
      updated: published,
      pdfUrl: it.resource?.primary?.URL || `https://doi.org/${doi}`,
      url: it.resource?.primary?.URL || `https://doi.org/${doi}`,
    });
  }

  return papers;
}

/** Ask OpenAlex which research field each DOI belongs to. */
async function addTopics(papers, { log }) {
  const discovered = new Map();

  for (let i = 0; i < papers.length; i += OA_BATCH) {
    const batch = papers.slice(i, i + OA_BATCH);
    const filter = 'doi:' + batch.map((p) => p.doi).join('|');
    const url = `${OPENALEX}?filter=${encodeURIComponent(filter)}&per-page=${OA_BATCH}&select=doi,primary_topic&mailto=${MAILTO}`;

    try {
      const data = await fetchJson(url, { log });
      const byDoi = new Map();
      for (const w of data.results || []) {
        const d = (w.doi || '').replace(/^https?:\/\/doi\.org\//, '').toLowerCase();
        if (d) byDoi.set(d, w.primary_topic);
      }

      for (const paper of batch) {
        const topic = byDoi.get(paper.doi.toLowerCase());
        const fieldName = topic?.field?.display_name;
        if (!fieldName) continue;
        const slug = slugify(fieldName);
        if (!discovered.has(slug)) discovered.set(slug, { slug, label: fieldName });
        paper.categories.push('techrxiv:' + slug);
      }
    } catch (err) {
      log(`    OpenAlex batch failed (${err.message}) — those papers stay uncategorised`);
    }

    if (i + OA_BATCH < papers.length) await sleep(DELAY_MS);
  }

  const uncategorised = papers.filter((p) => p.categories.length === 0);
  if (uncategorised.length) {
    discovered.set('engineering', discovered.get('engineering') || { slug: 'engineering', label: 'Engineering' });
    uncategorised.forEach((p) => p.categories.push('techrxiv:engineering'));
  }

  return [...discovered.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export default {
  id: 'techrxiv',
  label: 'TechRxiv',
  emoji: '⚙️',
  blurb: 'Engineering & technology preprints',

  taxonomy(discovered = []) {
    return [{
      id: '_all',
      label: null,
      categories: discovered.map(({ slug, label }) => ({
        id: 'techrxiv:' + slug,
        label,
        emoji: FIELD_EMOJI[slug] || '⚙️',
        code: slug,
      })),
    }];
  },

  async fetchAll({ log }) {
    const url = `${CROSSREF}?rows=${ROWS}&sort=created&order=desc&mailto=${MAILTO}`;
    const data = await fetchJson(url, { log });
    const papers = parseCrossref(data.message?.items || []);
    log(`  ${papers.length} papers with abstracts from Crossref`);

    this._discovered = await addTopics(papers, { log });
    log(`  ${this._discovered.length} research fields`);

    return papers.sort((a, b) => new Date(b.published) - new Date(a.published));
  },
};
