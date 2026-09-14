const ARXIV_API = 'https://export.arxiv.org/api/query';

// Papers are prefetched at build time by scripts/fetch-papers.mjs and served
// from this site's own origin, so the normal path needs no CORS proxy at all.
// Resolved from import.meta.url so it works at /paperspark/ and at the root.
const DATA_BASE = new URL('../data/', import.meta.url);

// Live fallback, used only when the prebuilt snapshot is missing a category.
// Public CORS proxies are unreliable (arXiv rate-limits their shared IPs), so
// every attempt is time-boxed and failure here is not fatal.
const CORS_PROXIES = [
  (url) => `https://cors.redoc.ly/${url}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
const PROXY_TIMEOUT_MS = 8000;

/**
 * Parse an arXiv Atom XML response into structured paper objects
 */
function parseAtomResponse(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const entries = doc.querySelectorAll('entry');
  const papers = [];

  for (const entry of entries) {
    const id = entry.querySelector('id')?.textContent || '';
    const arxivId = id.replace('http://arxiv.org/abs/', '').replace(/v\d+$/, '');
    const title = (entry.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim();
    const abstract = (entry.querySelector('summary')?.textContent || '').trim();
    const published = entry.querySelector('published')?.textContent || '';
    const updated = entry.querySelector('updated')?.textContent || '';

    // Skip entries that don't look like real papers (error entries)
    if (!title || title === 'Error' || !abstract) continue;

    const authors = [];
    entry.querySelectorAll('author > name').forEach(n => {
      authors.push(n.textContent.trim());
    });

    const categories = [];
    entry.querySelectorAll('category').forEach(cat => {
      const term = cat.getAttribute('term');
      if (term) categories.push(term);
    });

    const links = entry.querySelectorAll('link');
    let pdfUrl = '';
    let absUrl = '';
    for (const link of links) {
      if (link.getAttribute('title') === 'pdf') {
        pdfUrl = link.getAttribute('href') || '';
      }
      if (link.getAttribute('type') === 'text/html') {
        absUrl = link.getAttribute('href') || '';
      }
    }
    if (!absUrl) absUrl = `https://arxiv.org/abs/${arxivId}`;
    if (!pdfUrl) pdfUrl = `https://arxiv.org/pdf/${arxivId}`;

    papers.push({
      arxivId,
      title,
      authors,
      abstract,
      categories,
      published,
      updated,
      pdfUrl,
      url: absUrl
    });
  }
  return papers;
}

// Per-category memo, so paging to the end of the feed doesn't refetch the
// snapshots on every scroll tick.
const staticCache = new Map();

/**
 * Load a category's prebuilt paper list from this site's own origin.
 * Returns [] if that category wasn't part of the last build.
 */
function fetchStaticCategory(cat) {
  if (!staticCache.has(cat)) {
    // Don't memoize an empty result — a transient failure should be retryable.
    const pending = loadStaticCategory(cat).then((papers) => {
      if (papers.length === 0) staticCache.delete(cat);
      return papers;
    });
    staticCache.set(cat, pending);
  }
  return staticCache.get(cat);
}

async function loadStaticCategory(cat) {
  try {
    const resp = await fetch(new URL(`${encodeURIComponent(cat)}.json`, DATA_BASE), {
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data?.papers) ? data.papers : [];
  } catch {
    return [];
  }
}

/**
 * Merge the prebuilt snapshots for several categories, newest first.
 */
async function fetchStatic(categories) {
  const lists = await Promise.all(categories.map(fetchStaticCategory));

  const seen = new Set();
  const merged = [];
  for (const paper of lists.flat()) {
    if (!paper?.arxivId || seen.has(paper.arxivId)) continue;
    seen.add(paper.arxivId);
    merged.push(paper);
  }

  merged.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  return merged;
}

/**
 * Fetch live from arXiv through a CORS proxy (arXiv sends no CORS headers).
 * Each proxy is time-boxed so a hung request can't stall the feed.
 */
async function fetchArxiv(queryUrl) {
  // Raced rather than tried in turn: these proxies fail slowly and often, so
  // going one-by-one would stack their timeouts into a very long stall.
  const attempts = CORS_PROXIES.map(async (makeProxy) => {
    const resp = await fetch(makeProxy(queryUrl), {
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`proxy returned ${resp.status}`);

    const text = await resp.text();
    // An over-quota proxy gets a plain-text "Rate exceeded." from arXiv, which
    // still arrives as a 200 — so check that we actually got a feed back.
    if (!text.includes('<feed') && !text.includes('<entry')) {
      throw new Error('proxy returned no feed');
    }
    return text;
  });

  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error('Could not reach arXiv. Please try again later.');
  }
}


/**
 * Extract arXiv ID from a URL or string
 */
export function extractArxivId(input) {
  input = input.trim();
  const urlMatch = input.match(/arxiv\.org\/(?:abs|pdf)\/([\d.]+(?:v\d+)?)/i);
  if (urlMatch) return urlMatch[1].replace(/v\d+$/, '');
  const idMatch = input.match(/^(\d{4}\.\d{4,5})(?:v\d+)?$/);
  if (idMatch) return idMatch[1];
  return null;
}

/**
 * Search papers by keyword/title
 */
export async function searchPapers(query, maxResults = 10) {
  const q = encodeURIComponent(query.replace(/\s+/g, '+'));
  const url = `${ARXIV_API}?search_query=all:${q}&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
  const text = await fetchArxiv(url);
  return parseAtomResponse(text);
}

/**
 * Fetch a specific paper by arXiv ID
 */
export async function fetchById(arxivId) {
  const url = `${ARXIV_API}?id_list=${arxivId}`;
  const text = await fetchArxiv(url);
  const papers = parseAtomResponse(text);
  return papers.length > 0 ? papers[0] : null;
}

/**
 * Fetch recent papers by category.
 *
 * Reads the prebuilt snapshot first (same-origin, instant, never rate-limited)
 * and only reaches for a live proxied query if that turns up nothing.
 */
export async function fetchRecent(categories = ['cs.AI'], maxResults = 10) {
  const cats = categories.length ? categories : ['cs.AI'];

  const cached = await fetchStatic(cats);
  if (cached.length > 0) return cached.slice(0, maxResults);

  const catQuery = cats.map(c => `cat:${c}`).join('+OR+');
  const url = `${ARXIV_API}?search_query=${catQuery}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;
  const text = await fetchArxiv(url);
  return parseAtomResponse(text);
}

/**
 * Available arXiv categories organized by field
 */
export const ARXIV_CATEGORIES = {
  // ── Computer Science ──
  'cs.AI':  { label: 'Artificial Intelligence', field: 'cs', emoji: '🤖' },
  'cs.AR':  { label: 'Hardware Architecture', field: 'cs', emoji: '🔧' },
  'cs.CC':  { label: 'Computational Complexity', field: 'cs', emoji: '🧩' },
  'cs.CE':  { label: 'Computational Engineering', field: 'cs', emoji: '⚙️' },
  'cs.CG':  { label: 'Computational Geometry', field: 'cs', emoji: '📐' },
  'cs.CL':  { label: 'Computation & Language', field: 'cs', emoji: '💬' },
  'cs.CR':  { label: 'Cryptography & Security', field: 'cs', emoji: '🔐' },
  'cs.CV':  { label: 'Computer Vision', field: 'cs', emoji: '👁️' },
  'cs.CY':  { label: 'Computers & Society', field: 'cs', emoji: '🏛️' },
  'cs.DB':  { label: 'Databases', field: 'cs', emoji: '🗄️' },
  'cs.DC':  { label: 'Distributed Computing', field: 'cs', emoji: '🌐' },
  'cs.DL':  { label: 'Digital Libraries', field: 'cs', emoji: '📚' },
  'cs.DM':  { label: 'Discrete Mathematics', field: 'cs', emoji: '🔢' },
  'cs.DS':  { label: 'Data Structures & Algorithms', field: 'cs', emoji: '📊' },
  'cs.ET':  { label: 'Emerging Technologies', field: 'cs', emoji: '🚀' },
  'cs.FL':  { label: 'Formal Languages & Automata', field: 'cs', emoji: '🔤' },
  'cs.GL':  { label: 'General Literature', field: 'cs', emoji: '📖' },
  'cs.GR':  { label: 'Graphics', field: 'cs', emoji: '🎨' },
  'cs.GT':  { label: 'Game Theory (CS)', field: 'cs', emoji: '🎯' },
  'cs.HC':  { label: 'Human-Computer Interaction', field: 'cs', emoji: '🖱️' },
  'cs.IR':  { label: 'Information Retrieval', field: 'cs', emoji: '🔍' },
  'cs.IT':  { label: 'Information Theory', field: 'cs', emoji: '📡' },
  'cs.LG':  { label: 'Machine Learning', field: 'cs', emoji: '🧠' },
  'cs.LO':  { label: 'Logic in CS', field: 'cs', emoji: '🔬' },
  'cs.MA':  { label: 'Multiagent Systems', field: 'cs', emoji: '👥' },
  'cs.MM':  { label: 'Multimedia', field: 'cs', emoji: '🎬' },
  'cs.MS':  { label: 'Mathematical Software', field: 'cs', emoji: '🧮' },
  'cs.NA':  { label: 'Numerical Analysis', field: 'cs', emoji: '🔣' },
  'cs.NE':  { label: 'Neural & Evolutionary Computing', field: 'cs', emoji: '⚡' },
  'cs.NI':  { label: 'Networking & Internet', field: 'cs', emoji: '🌍' },
  'cs.OH':  { label: 'Other CS', field: 'cs', emoji: '📎' },
  'cs.OS':  { label: 'Operating Systems', field: 'cs', emoji: '🖥️' },
  'cs.PF':  { label: 'Performance', field: 'cs', emoji: '⏱️' },
  'cs.PL':  { label: 'Programming Languages', field: 'cs', emoji: '💻' },
  'cs.RO':  { label: 'Robotics', field: 'cs', emoji: '🦾' },
  'cs.SC':  { label: 'Symbolic Computation', field: 'cs', emoji: '∑' },
  'cs.SD':  { label: 'Sound', field: 'cs', emoji: '🔊' },
  'cs.SE':  { label: 'Software Engineering', field: 'cs', emoji: '🛠️' },
  'cs.SI':  { label: 'Social & Info Networks', field: 'cs', emoji: '🕸️' },
  'cs.SY':  { label: 'Systems & Control', field: 'cs', emoji: '🎛️' },

  // ── Economics ──
  'econ.TH': { label: 'Theoretical Economics', field: 'econ', emoji: '💹' },

  // ── EESS ──
  'eess.AS': { label: 'Audio & Speech Processing', field: 'eess', emoji: '🎙️' },
  'eess.IV': { label: 'Image & Video Processing', field: 'eess', emoji: '🖼️' },
  'eess.SP': { label: 'Signal Processing', field: 'eess', emoji: '📶' },
  'eess.SY': { label: 'Systems & Control (EESS)', field: 'eess', emoji: '🎛️' },

  // ── Mathematics ──
  'math.AP': { label: 'Analysis of PDEs', field: 'math', emoji: '∂' },
  'math.CA': { label: 'Classical Analysis & ODEs', field: 'math', emoji: '∫' },
  'math.IT': { label: 'Information Theory (Math)', field: 'math', emoji: '📡' },
  'math.MP': { label: 'Mathematical Physics', field: 'math', emoji: '⚛️' },
  'math.PR': { label: 'Probability', field: 'math', emoji: '🎲' },

  // ── Astrophysics ──
  'astro-ph.CO': { label: 'Cosmology', field: 'astro', emoji: '🌌' },
  'astro-ph.EP': { label: 'Earth & Planetary Astro', field: 'astro', emoji: '🪐' },
  'astro-ph.GA': { label: 'Astrophysics of Galaxies', field: 'astro', emoji: '🌀' },
  'astro-ph.HE': { label: 'High Energy Astro', field: 'astro', emoji: '💥' },
  'astro-ph.IM': { label: 'Astro Instrumentation', field: 'astro', emoji: '🔭' },
  'astro-ph.SR': { label: 'Solar & Stellar Astro', field: 'astro', emoji: '☀️' },

  // ── Condensed Matter ──
  'cond-mat.dis-nn':  { label: 'Disordered Systems & Neural Nets', field: 'cond-mat', emoji: '🌀' },
  'cond-mat.mes-hall': { label: 'Mesoscale & Nanoscale Physics', field: 'cond-mat', emoji: '🔬' },
  'cond-mat.mtrl-sci': { label: 'Materials Science', field: 'cond-mat', emoji: '🧱' },
  'cond-mat.other':    { label: 'Other Condensed Matter', field: 'cond-mat', emoji: '🧊' },
  'cond-mat.quant-gas':{ label: 'Quantum Gases', field: 'cond-mat', emoji: '❄️' },
  'cond-mat.soft':     { label: 'Soft Condensed Matter', field: 'cond-mat', emoji: '🫧' },
  'cond-mat.stat-mech':{ label: 'Statistical Mechanics', field: 'cond-mat', emoji: '🌡️' },
  'cond-mat.str-el':   { label: 'Strongly Correlated Electrons', field: 'cond-mat', emoji: '⚡' },
  'cond-mat.supr-con': { label: 'Superconductivity', field: 'cond-mat', emoji: '🧲' },

  // ── Mathematical Physics ──
  'math-ph': { label: 'Mathematical Physics', field: 'math-ph', emoji: '⚛️' },

  // ── Nonlinear Sciences ──
  'nlin.AO': { label: 'Self-Organizing Systems', field: 'nlin', emoji: '🦠' },
  'nlin.CD': { label: 'Chaotic Dynamics', field: 'nlin', emoji: '🌊' },
  'nlin.CG': { label: 'Cellular Automata', field: 'nlin', emoji: '🏁' },
  'nlin.PS': { label: 'Pattern Formation & Solitons', field: 'nlin', emoji: '🌈' },
  'nlin.SI': { label: 'Integrable Systems', field: 'nlin', emoji: '♾️' },

  // ── Physics ──
  'physics.ao-ph':   { label: 'Atmospheric & Oceanic Physics', field: 'physics', emoji: '🌊' },
  'physics.app-ph':  { label: 'Applied Physics', field: 'physics', emoji: '🔌' },
  'physics.atm-clus':{ label: 'Atomic & Molecular Clusters', field: 'physics', emoji: '⚛️' },
  'physics.atom-ph': { label: 'Atomic Physics', field: 'physics', emoji: '⚛️' },
  'physics.bio-ph':  { label: 'Biological Physics', field: 'physics', emoji: '🧬' },
  'physics.flu-dyn': { label: 'Fluid Dynamics', field: 'physics', emoji: '💧' },

  // ── Quantitative Biology ──
  'q-bio.BM': { label: 'Biomolecules', field: 'q-bio', emoji: '🧬' },
  'q-bio.CB': { label: 'Cell Behavior', field: 'q-bio', emoji: '🦠' },
  'q-bio.GN': { label: 'Genomics', field: 'q-bio', emoji: '🧬' },
  'q-bio.MN': { label: 'Molecular Networks', field: 'q-bio', emoji: '🕸️' },
  'q-bio.NC': { label: 'Neurons & Cognition', field: 'q-bio', emoji: '🧠' },
  'q-bio.OT': { label: 'Other Quantitative Biology', field: 'q-bio', emoji: '🔬' },
  'q-bio.PE': { label: 'Populations & Evolution', field: 'q-bio', emoji: '🌱' },
  'q-bio.QM': { label: 'Quantitative Methods (Bio)', field: 'q-bio', emoji: '📏' },
  'q-bio.SC': { label: 'Subcellular Processes', field: 'q-bio', emoji: '🔬' },
  'q-bio.TO': { label: 'Tissues & Organs', field: 'q-bio', emoji: '🫀' },

  // ── Quantitative Finance ──
  'q-fin.CP': { label: 'Computational Finance', field: 'q-fin', emoji: '💹' },
  'q-fin.EC': { label: 'Economics (Finance)', field: 'q-fin', emoji: '📈' },
  'q-fin.GN': { label: 'General Finance', field: 'q-fin', emoji: '🏦' },
  'q-fin.MF': { label: 'Mathematical Finance', field: 'q-fin', emoji: '📊' },

  // ── Statistics ──
  'stat.ME': { label: 'Statistical Methodology', field: 'stat', emoji: '📉' },
  'stat.ML': { label: 'Machine Learning (Stat)', field: 'stat', emoji: '📈' },
  'stat.OT': { label: 'Other Statistics', field: 'stat', emoji: '📊' },
  'stat.TH': { label: 'Statistics Theory', field: 'stat', emoji: '🎓' },
};

/**
 * Get a display-friendly category name
 */
export function getCategoryLabel(catKey) {
  return ARXIV_CATEGORIES[catKey]?.label || catKey;
}

/**
 * Get the field from a category key
 */
export function getCategoryField(catKey) {
  return ARXIV_CATEGORIES[catKey]?.field || 'cs';
}
