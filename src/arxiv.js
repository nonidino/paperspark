// arxiv.js — arXiv category taxonomy.
//
// Pure metadata: fetching lives in feed.js (browser) and scripts/sources/
// (build). Keeping it static lets the build generate the catalog and lets the
// app label arXiv categories without waiting on a network read.

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
