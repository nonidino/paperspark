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
 * Every arXiv category, mirroring the official taxonomy at
 * https://arxiv.org/category_taxonomy — `group` is one of the eight top-level
 * groups in ARXIV_GROUPS, `archive` is the sub-archive used to order the
 * sprawling Physics group the way arXiv lists it.
 */
export const ARXIV_CATEGORIES = {

  // ── Computer Science ──
  'cs.AI':              { label: "Artificial Intelligence", group: 'cs', archive: 'cs', emoji: '🤖' },
  'cs.AR':              { label: "Hardware Architecture", group: 'cs', archive: 'cs', emoji: '🔧' },
  'cs.CC':              { label: "Computational Complexity", group: 'cs', archive: 'cs', emoji: '🧩' },
  'cs.CE':              { label: "Computational Engineering, Finance, and Science", group: 'cs', archive: 'cs', emoji: '⚙️' },
  'cs.CG':              { label: "Computational Geometry", group: 'cs', archive: 'cs', emoji: '📐' },
  'cs.CL':              { label: "Computation and Language", group: 'cs', archive: 'cs', emoji: '💬' },
  'cs.CR':              { label: "Cryptography and Security", group: 'cs', archive: 'cs', emoji: '🔐' },
  'cs.CV':              { label: "Computer Vision and Pattern Recognition", group: 'cs', archive: 'cs', emoji: '👁️' },
  'cs.CY':              { label: "Computers and Society", group: 'cs', archive: 'cs', emoji: '🏛️' },
  'cs.DB':              { label: "Databases", group: 'cs', archive: 'cs', emoji: '🗄️' },
  'cs.DC':              { label: "Distributed, Parallel, and Cluster Computing", group: 'cs', archive: 'cs', emoji: '🌐' },
  'cs.DL':              { label: "Digital Libraries", group: 'cs', archive: 'cs', emoji: '📚' },
  'cs.DM':              { label: "Discrete Mathematics", group: 'cs', archive: 'cs', emoji: '🔢' },
  'cs.DS':              { label: "Data Structures and Algorithms", group: 'cs', archive: 'cs', emoji: '📊' },
  'cs.ET':              { label: "Emerging Technologies", group: 'cs', archive: 'cs', emoji: '🚀' },
  'cs.FL':              { label: "Formal Languages and Automata Theory", group: 'cs', archive: 'cs', emoji: '🔤' },
  'cs.GL':              { label: "General Literature", group: 'cs', archive: 'cs', emoji: '📖' },
  'cs.GR':              { label: "Graphics", group: 'cs', archive: 'cs', emoji: '🎨' },
  'cs.GT':              { label: "Computer Science and Game Theory", group: 'cs', archive: 'cs', emoji: '🎯' },
  'cs.HC':              { label: "Human-Computer Interaction", group: 'cs', archive: 'cs', emoji: '🖱️' },
  'cs.IR':              { label: "Information Retrieval", group: 'cs', archive: 'cs', emoji: '🔍' },
  'cs.IT':              { label: "Information Theory", group: 'cs', archive: 'cs', emoji: '📡' },
  'cs.LG':              { label: "Machine Learning", group: 'cs', archive: 'cs', emoji: '🧠' },
  'cs.LO':              { label: "Logic in Computer Science", group: 'cs', archive: 'cs', emoji: '🔬' },
  'cs.MA':              { label: "Multiagent Systems", group: 'cs', archive: 'cs', emoji: '👥' },
  'cs.MM':              { label: "Multimedia", group: 'cs', archive: 'cs', emoji: '🎬' },
  'cs.MS':              { label: "Mathematical Software", group: 'cs', archive: 'cs', emoji: '🧮' },
  'cs.NA':              { label: "Numerical Analysis", group: 'cs', archive: 'cs', emoji: '🔣' },
  'cs.NE':              { label: "Neural and Evolutionary Computing", group: 'cs', archive: 'cs', emoji: '⚡' },
  'cs.NI':              { label: "Networking and Internet Architecture", group: 'cs', archive: 'cs', emoji: '🌍' },
  'cs.OH':              { label: "Other Computer Science", group: 'cs', archive: 'cs', emoji: '📎' },
  'cs.OS':              { label: "Operating Systems", group: 'cs', archive: 'cs', emoji: '🖥️' },
  'cs.PF':              { label: "Performance", group: 'cs', archive: 'cs', emoji: '⏱️' },
  'cs.PL':              { label: "Programming Languages", group: 'cs', archive: 'cs', emoji: '💻' },
  'cs.RO':              { label: "Robotics", group: 'cs', archive: 'cs', emoji: '🦾' },
  'cs.SC':              { label: "Symbolic Computation", group: 'cs', archive: 'cs', emoji: '∑' },
  'cs.SD':              { label: "Sound", group: 'cs', archive: 'cs', emoji: '🔊' },
  'cs.SE':              { label: "Software Engineering", group: 'cs', archive: 'cs', emoji: '🛠️' },
  'cs.SI':              { label: "Social and Information Networks", group: 'cs', archive: 'cs', emoji: '🕸️' },
  'cs.SY':              { label: "Systems and Control", group: 'cs', archive: 'cs', emoji: '🎛️' },

  // ── Economics ──
  'econ.EM':            { label: "Econometrics", group: 'econ', archive: 'econ', emoji: '💹' },
  'econ.GN':            { label: "General Economics", group: 'econ', archive: 'econ', emoji: '💹' },
  'econ.TH':            { label: "Theoretical Economics", group: 'econ', archive: 'econ', emoji: '💹' },

  // ── Electrical Engineering and Systems Science ──
  'eess.AS':            { label: "Audio and Speech Processing", group: 'eess', archive: 'eess', emoji: '🎙️' },
  'eess.IV':            { label: "Image and Video Processing", group: 'eess', archive: 'eess', emoji: '🖼️' },
  'eess.SP':            { label: "Signal Processing", group: 'eess', archive: 'eess', emoji: '📶' },
  'eess.SY':            { label: "Systems and Control", group: 'eess', archive: 'eess', emoji: '🎛️' },

  // ── Mathematics ──
  'math.AC':            { label: "Commutative Algebra", group: 'math', archive: 'math', emoji: '📐' },
  'math.AG':            { label: "Algebraic Geometry", group: 'math', archive: 'math', emoji: '📐' },
  'math.AP':            { label: "Analysis of PDEs", group: 'math', archive: 'math', emoji: '∂' },
  'math.AT':            { label: "Algebraic Topology", group: 'math', archive: 'math', emoji: '📐' },
  'math.CA':            { label: "Classical Analysis and ODEs", group: 'math', archive: 'math', emoji: '∫' },
  'math.CO':            { label: "Combinatorics", group: 'math', archive: 'math', emoji: '📐' },
  'math.CT':            { label: "Category Theory", group: 'math', archive: 'math', emoji: '📐' },
  'math.CV':            { label: "Complex Variables", group: 'math', archive: 'math', emoji: '📐' },
  'math.DG':            { label: "Differential Geometry", group: 'math', archive: 'math', emoji: '📐' },
  'math.DS':            { label: "Dynamical Systems", group: 'math', archive: 'math', emoji: '📐' },
  'math.FA':            { label: "Functional Analysis", group: 'math', archive: 'math', emoji: '📐' },
  'math.GM':            { label: "General Mathematics", group: 'math', archive: 'math', emoji: '📐' },
  'math.GN':            { label: "General Topology", group: 'math', archive: 'math', emoji: '📐' },
  'math.GR':            { label: "Group Theory", group: 'math', archive: 'math', emoji: '📐' },
  'math.GT':            { label: "Geometric Topology", group: 'math', archive: 'math', emoji: '📐' },
  'math.HO':            { label: "History and Overview", group: 'math', archive: 'math', emoji: '📐' },
  'math.IT':            { label: "Information Theory", group: 'math', archive: 'math', emoji: '📡' },
  'math.KT':            { label: "K-Theory and Homology", group: 'math', archive: 'math', emoji: '📐' },
  'math.LO':            { label: "Logic", group: 'math', archive: 'math', emoji: '📐' },
  'math.MG':            { label: "Metric Geometry", group: 'math', archive: 'math', emoji: '📐' },
  'math.MP':            { label: "Mathematical Physics", group: 'math', archive: 'math', emoji: '⚛️' },
  'math.NA':            { label: "Numerical Analysis", group: 'math', archive: 'math', emoji: '📐' },
  'math.NT':            { label: "Number Theory", group: 'math', archive: 'math', emoji: '📐' },
  'math.OA':            { label: "Operator Algebras", group: 'math', archive: 'math', emoji: '📐' },
  'math.OC':            { label: "Optimization and Control", group: 'math', archive: 'math', emoji: '📐' },
  'math.PR':            { label: "Probability", group: 'math', archive: 'math', emoji: '🎲' },
  'math.QA':            { label: "Quantum Algebra", group: 'math', archive: 'math', emoji: '📐' },
  'math.RA':            { label: "Rings and Algebras", group: 'math', archive: 'math', emoji: '📐' },
  'math.RT':            { label: "Representation Theory", group: 'math', archive: 'math', emoji: '📐' },
  'math.SG':            { label: "Symplectic Geometry", group: 'math', archive: 'math', emoji: '📐' },
  'math.SP':            { label: "Spectral Theory", group: 'math', archive: 'math', emoji: '📐' },
  'math.ST':            { label: "Statistics Theory", group: 'math', archive: 'math', emoji: '📐' },

  // ── Physics ──
  // astro-ph
  'astro-ph.CO':        { label: "Cosmology and Nongalactic Astrophysics", group: 'physics', archive: 'astro-ph', emoji: '🌌' },
  'astro-ph.EP':        { label: "Earth and Planetary Astrophysics", group: 'physics', archive: 'astro-ph', emoji: '🪐' },
  'astro-ph.GA':        { label: "Astrophysics of Galaxies", group: 'physics', archive: 'astro-ph', emoji: '🌀' },
  'astro-ph.HE':        { label: "High Energy Astrophysical Phenomena", group: 'physics', archive: 'astro-ph', emoji: '💥' },
  'astro-ph.IM':        { label: "Instrumentation and Methods for Astrophysics", group: 'physics', archive: 'astro-ph', emoji: '🔭' },
  'astro-ph.SR':        { label: "Solar and Stellar Astrophysics", group: 'physics', archive: 'astro-ph', emoji: '☀️' },
  // cond-mat
  'cond-mat.dis-nn':    { label: "Disordered Systems and Neural Networks", group: 'physics', archive: 'cond-mat', emoji: '🌀' },
  'cond-mat.mes-hall':  { label: "Mesoscale and Nanoscale Physics", group: 'physics', archive: 'cond-mat', emoji: '🔬' },
  'cond-mat.mtrl-sci':  { label: "Materials Science", group: 'physics', archive: 'cond-mat', emoji: '🧱' },
  'cond-mat.other':     { label: "Other Condensed Matter", group: 'physics', archive: 'cond-mat', emoji: '🧊' },
  'cond-mat.quant-gas': { label: "Quantum Gases", group: 'physics', archive: 'cond-mat', emoji: '❄️' },
  'cond-mat.soft':      { label: "Soft Condensed Matter", group: 'physics', archive: 'cond-mat', emoji: '🫧' },
  'cond-mat.stat-mech': { label: "Statistical Mechanics", group: 'physics', archive: 'cond-mat', emoji: '🌡️' },
  'cond-mat.str-el':    { label: "Strongly Correlated Electrons", group: 'physics', archive: 'cond-mat', emoji: '⚡' },
  'cond-mat.supr-con':  { label: "Superconductivity", group: 'physics', archive: 'cond-mat', emoji: '🧲' },
  // gr-qc
  'gr-qc':              { label: "General Relativity and Quantum Cosmology", group: 'physics', archive: 'gr-qc', emoji: '🌀' },
  // hep-ex
  'hep-ex':             { label: "High Energy Physics - Experiment", group: 'physics', archive: 'hep-ex', emoji: '⚛️' },
  // hep-lat
  'hep-lat':            { label: "High Energy Physics - Lattice", group: 'physics', archive: 'hep-lat', emoji: '⚛️' },
  // hep-ph
  'hep-ph':             { label: "High Energy Physics - Phenomenology", group: 'physics', archive: 'hep-ph', emoji: '⚛️' },
  // hep-th
  'hep-th':             { label: "High Energy Physics - Theory", group: 'physics', archive: 'hep-th', emoji: '⚛️' },
  // math-ph
  'math-ph':            { label: "Mathematical Physics", group: 'physics', archive: 'math-ph', emoji: '⚛️' },
  // nlin
  'nlin.AO':            { label: "Adaptation and Self-Organizing Systems", group: 'physics', archive: 'nlin', emoji: '🦠' },
  'nlin.CD':            { label: "Chaotic Dynamics", group: 'physics', archive: 'nlin', emoji: '🌊' },
  'nlin.CG':            { label: "Cellular Automata and Lattice Gases", group: 'physics', archive: 'nlin', emoji: '🏁' },
  'nlin.PS':            { label: "Pattern Formation and Solitons", group: 'physics', archive: 'nlin', emoji: '🌈' },
  'nlin.SI':            { label: "Exactly Solvable and Integrable Systems", group: 'physics', archive: 'nlin', emoji: '♾️' },
  // nucl-ex
  'nucl-ex':            { label: "Nuclear Experiment", group: 'physics', archive: 'nucl-ex', emoji: '☢️' },
  // nucl-th
  'nucl-th':            { label: "Nuclear Theory", group: 'physics', archive: 'nucl-th', emoji: '☢️' },
  // physics
  'physics.acc-ph':     { label: "Accelerator Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.ao-ph':      { label: "Atmospheric and Oceanic Physics", group: 'physics', archive: 'physics', emoji: '🌊' },
  'physics.app-ph':     { label: "Applied Physics", group: 'physics', archive: 'physics', emoji: '🔌' },
  'physics.atm-clus':   { label: "Atomic and Molecular Clusters", group: 'physics', archive: 'physics', emoji: '⚛️' },
  'physics.atom-ph':    { label: "Atomic Physics", group: 'physics', archive: 'physics', emoji: '⚛️' },
  'physics.bio-ph':     { label: "Biological Physics", group: 'physics', archive: 'physics', emoji: '🧬' },
  'physics.chem-ph':    { label: "Chemical Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.class-ph':   { label: "Classical Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.comp-ph':    { label: "Computational Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.data-an':    { label: "Data Analysis, Statistics and Probability", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.ed-ph':      { label: "Physics Education", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.flu-dyn':    { label: "Fluid Dynamics", group: 'physics', archive: 'physics', emoji: '💧' },
  'physics.gen-ph':     { label: "General Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.geo-ph':     { label: "Geophysics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.hist-ph':    { label: "History and Philosophy of Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.ins-det':    { label: "Instrumentation and Detectors", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.med-ph':     { label: "Medical Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.optics':     { label: "Optics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.plasm-ph':   { label: "Plasma Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.pop-ph':     { label: "Popular Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.soc-ph':     { label: "Physics and Society", group: 'physics', archive: 'physics', emoji: '🔬' },
  'physics.space-ph':   { label: "Space Physics", group: 'physics', archive: 'physics', emoji: '🔬' },
  // quant-ph
  'quant-ph':           { label: "Quantum Physics", group: 'physics', archive: 'quant-ph', emoji: '⚛️' },

  // ── Quantitative Biology ──
  'q-bio.BM':           { label: "Biomolecules", group: 'q-bio', archive: 'q-bio', emoji: '🧬' },
  'q-bio.CB':           { label: "Cell Behavior", group: 'q-bio', archive: 'q-bio', emoji: '🦠' },
  'q-bio.GN':           { label: "Genomics", group: 'q-bio', archive: 'q-bio', emoji: '🧬' },
  'q-bio.MN':           { label: "Molecular Networks", group: 'q-bio', archive: 'q-bio', emoji: '🕸️' },
  'q-bio.NC':           { label: "Neurons and Cognition", group: 'q-bio', archive: 'q-bio', emoji: '🧠' },
  'q-bio.OT':           { label: "Other Quantitative Biology", group: 'q-bio', archive: 'q-bio', emoji: '🔬' },
  'q-bio.PE':           { label: "Populations and Evolution", group: 'q-bio', archive: 'q-bio', emoji: '🌱' },
  'q-bio.QM':           { label: "Quantitative Methods", group: 'q-bio', archive: 'q-bio', emoji: '📏' },
  'q-bio.SC':           { label: "Subcellular Processes", group: 'q-bio', archive: 'q-bio', emoji: '🔬' },
  'q-bio.TO':           { label: "Tissues and Organs", group: 'q-bio', archive: 'q-bio', emoji: '🫀' },

  // ── Quantitative Finance ──
  'q-fin.CP':           { label: "Computational Finance", group: 'q-fin', archive: 'q-fin', emoji: '💹' },
  'q-fin.EC':           { label: "Economics", group: 'q-fin', archive: 'q-fin', emoji: '📈' },
  'q-fin.GN':           { label: "General Finance", group: 'q-fin', archive: 'q-fin', emoji: '🏦' },
  'q-fin.MF':           { label: "Mathematical Finance", group: 'q-fin', archive: 'q-fin', emoji: '📊' },
  'q-fin.PM':           { label: "Portfolio Management", group: 'q-fin', archive: 'q-fin', emoji: '🏦' },
  'q-fin.PR':           { label: "Pricing of Securities", group: 'q-fin', archive: 'q-fin', emoji: '🏦' },
  'q-fin.RM':           { label: "Risk Management", group: 'q-fin', archive: 'q-fin', emoji: '🏦' },
  'q-fin.ST':           { label: "Statistical Finance", group: 'q-fin', archive: 'q-fin', emoji: '🏦' },
  'q-fin.TR':           { label: "Trading and Market Microstructure", group: 'q-fin', archive: 'q-fin', emoji: '🏦' },

  // ── Statistics ──
  'stat.AP':            { label: "Applications", group: 'stat', archive: 'stat', emoji: '📈' },
  'stat.CO':            { label: "Computation", group: 'stat', archive: 'stat', emoji: '📈' },
  'stat.ME':            { label: "Methodology", group: 'stat', archive: 'stat', emoji: '📉' },
  'stat.ML':            { label: "Machine Learning", group: 'stat', archive: 'stat', emoji: '📈' },
  'stat.OT':            { label: "Other Statistics", group: 'stat', archive: 'stat', emoji: '📊' },
  'stat.TH':            { label: "Statistics Theory", group: 'stat', archive: 'stat', emoji: '🎓' },
};

/**
 * Get a display-friendly category name
 */
export function getCategoryLabel(catKey) {
  return ARXIV_CATEGORIES[catKey]?.label || catKey;
}

/**
 * Get the top-level arXiv group a category belongs to.
 */
export function getCategoryGroup(catKey) {
  return ARXIV_CATEGORIES[catKey]?.group || 'cs';
}

/**
 * arXiv's eight top-level groups, in the order the site lists them.
 * Physics covers astro-ph, cond-mat, gr-qc, hep-*, math-ph, nlin, nucl-*,
 * physics.* and quant-ph, which is why those aren't groups of their own.
 */
export const ARXIV_GROUPS = {
  cs:        { label: 'Computer Science', emoji: '💻' },
  econ:      { label: 'Economics', emoji: '💹' },
  eess:      { label: 'Electrical Engineering and Systems Science', emoji: '📶' },
  math:      { label: 'Mathematics', emoji: '📐' },
  physics:   { label: 'Physics', emoji: '🔬' },
  'q-bio':   { label: 'Quantitative Biology', emoji: '🧬' },
  'q-fin':   { label: 'Quantitative Finance', emoji: '🏦' },
  stat:      { label: 'Statistics', emoji: '📈' },
};
