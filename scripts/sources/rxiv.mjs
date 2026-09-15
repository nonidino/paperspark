// rxiv.mjs — bioRxiv and medRxiv. Same infrastructure, same feed shape, so one
// module builds both.
//
// Uses the per-subject RSS at connect.{bio,med}rxiv.org rather than the JSON
// details API: the API pages 30 at a time over thousands of records, while one
// RSS request per subject returns that subject's 30 newest — and the subject is
// known from the request, since the feed items carry no category tag.

import { fetchText, blocks, tagText, toIso, sleep, titleCase } from '../lib/common.mjs';

const DELAY_MS = 1200;

// Slugs come from the live collection pages; labels are derived from the slug
// except where that would read badly.
const LABEL_OVERRIDES = {
  'hiv-aids': 'HIV/AIDS',
  'endocrinology-including-diabetes-mellitus-and-metabolic-disease': 'Endocrinology & Metabolism',
  'rehabilitation-medicine-and-physical-therapy': 'Rehabilitation & Physical Therapy',
  'health-systems-and-quality-improvement': 'Health Systems & Quality',
  'occupational-and-environmental-health': 'Occupational & Environmental Health',
  'scientific-communication-and-education': 'Scientific Communication & Education',
  'animal-behavior-and-cognition': 'Animal Behavior & Cognition',
  'pharmacology-and-toxicology': 'Pharmacology & Toxicology',
  'pharmacology-and-therapeutics': 'Pharmacology & Therapeutics',
  'genetic-and-genomic-medicine': 'Genetic & Genomic Medicine',
  'dentistry-and-oral-medicine': 'Dentistry & Oral Medicine',
  'allergy-and-immunology': 'Allergy & Immunology',
  'public-and-global-health': 'Public & Global Health',
  'sexual-and-reproductive-health': 'Sexual & Reproductive Health',
  'radiology-and-imaging': 'Radiology & Imaging',
  'intensive-care-and-critical-care-medicine': 'Intensive & Critical Care',
  'obstetrics-and-gynecology': 'Obstetrics & Gynecology',
  'primary-care-research': 'Primary Care Research',
};

const BIORXIV_SUBJECTS = [
  'animal-behavior-and-cognition', 'biochemistry', 'bioengineering', 'bioinformatics',
  'biophysics', 'cancer-biology', 'cell-biology', 'clinical-trials', 'developmental-biology',
  'ecology', 'epidemiology', 'evolutionary-biology', 'genetics', 'genomics', 'immunology',
  'microbiology', 'molecular-biology', 'neuroscience', 'paleontology', 'pathology',
  'pharmacology-and-toxicology', 'physiology', 'plant-biology',
  'scientific-communication-and-education', 'synthetic-biology', 'systems-biology', 'zoology',
];

const MEDRXIV_SUBJECTS = [
  'addiction-medicine', 'allergy-and-immunology', 'anesthesia', 'cardiovascular-medicine',
  'dentistry-and-oral-medicine', 'dermatology', 'emergency-medicine',
  'endocrinology-including-diabetes-mellitus-and-metabolic-disease', 'epidemiology',
  'forensic-medicine', 'gastroenterology', 'genetic-and-genomic-medicine', 'geriatric-medicine',
  'health-economics', 'health-informatics', 'health-policy',
  'health-systems-and-quality-improvement', 'hematology', 'hiv-aids',
  'intensive-care-and-critical-care-medicine', 'medical-education', 'medical-ethics',
  'nephrology', 'neurology', 'nursing', 'nutrition', 'obstetrics-and-gynecology',
  'occupational-and-environmental-health', 'oncology', 'ophthalmology', 'orthopedics',
  'otolaryngology', 'pain-medicine', 'palliative-medicine', 'pathology', 'pediatrics',
  'pharmacology-and-therapeutics', 'primary-care-research', 'psychiatry-and-clinical-psychology',
  'public-and-global-health', 'radiology-and-imaging',
  'rehabilitation-medicine-and-physical-therapy', 'respiratory-medicine', 'rheumatology',
  'sexual-and-reproductive-health', 'sports-medicine', 'surgery', 'toxicology',
  'transplantation', 'urology',
];

const SUBJECT_EMOJI = {
  neuroscience: '🧠', genomics: '🧬', genetics: '🧬', bioinformatics: '💻', biophysics: '⚛️',
  'cancer-biology': '🎗️', immunology: '🛡️', microbiology: '🦠', ecology: '🌿',
  'plant-biology': '🌱', zoology: '🐾', paleontology: '🦴', physiology: '🫀',
  'cell-biology': '🔬', biochemistry: '🧪', bioengineering: '⚙️', 'synthetic-biology': '🧫',
  'systems-biology': '🕸️', 'developmental-biology': '🐣', 'evolutionary-biology': '🐒',
  'molecular-biology': '🧬', pathology: '🩺', epidemiology: '📊', 'clinical-trials': '💊',
  'cardiovascular-medicine': '🫀', oncology: '🎗️', neurology: '🧠', pediatrics: '🧒',
  'psychiatry-and-clinical-psychology': '🧠', surgery: '🔪', dermatology: '🩹',
  'public-and-global-health': '🌍', 'health-policy': '🏛️', 'health-informatics': '💻',
  'health-economics': '💹', nutrition: '🥗', 'sports-medicine': '🏃', urology: '🩺',
  'respiratory-medicine': '🫁', ophthalmology: '👁️', nursing: '🧑‍⚕️', 'hiv-aids': '🎗️',
};

function parseRdf(xml, { sourceId, category, siteBase }) {
  const papers = [];

  for (const item of blocks(xml, 'item')) {
    const title = tagText(item, 'title');
    const abstract = tagText(item, 'description');
    const link = (tagText(item, 'link') || '').split('?')[0];
    if (!title || !abstract || !link) continue;

    // Links look like https://www.biorxiv.org/content/10.1101/2026.09.08.750121v1
    const m = link.match(/content\/(10\.\d{4,9}\/[^v?#]+)(v\d+)?/);
    const doi = m ? m[1] : link;

    papers.push({
      id: `${sourceId}:${doi}`,
      doi,
      source: sourceId,
      title,
      authors: splitAuthors(tagText(item, 'dc:creator')),
      abstract,
      categories: [`${sourceId}:${category}`],
      published: toIso(tagText(item, 'dc:date') || tagText(item, 'pubDate')),
      updated: toIso(tagText(item, 'dc:date') || tagText(item, 'pubDate')),
      pdfUrl: link + '.full.pdf',
      url: link,
      siteBase,
    });
  }

  return papers;
}

// The feeds give "Mathew, N. C., Park, K. K." — commas separate the surname
// from the initials *and* one author from the next, so a plain split loses
// people. Match surname + initials pairs instead, and ignore trailing
// consortium credits ("for the ... Initiative") that carry no initials.
const AUTHOR_RE = /([^,;]+?),\s*((?:[A-Z]\.(?:-[A-Z]\.)?\s*)+)/g;

function splitAuthors(creator) {
  if (!creator) return [];

  const out = [];
  let m;
  AUTHOR_RE.lastIndex = 0;
  while ((m = AUTHOR_RE.exec(creator))) {
    const surname = m[1].trim().replace(/^(?:and|&)\s+/i, '');
    const initials = m[2].trim();
    if (surname) out.push(`${initials} ${surname}`);
  }

  // No recognisable "Surname, I." pairs — fall back to a simple split.
  if (out.length === 0) {
    return creator.split(/[;,]/).map((a) => a.trim()).filter(Boolean);
  }
  return out;
}

// The two servers spell the ?subject= parameter differently from the URL slug,
// and differently from each other — bioRxiv wants spaces, medRxiv underscores.
// Getting it wrong returns an empty feed rather than an error, so these were
// checked against every subject on both servers.
const FEED_PARAM_OVERRIDES = {
  // medRxiv's RSS answers to the short name, not the full collection slug.
  'endocrinology-including-diabetes-mellitus-and-metabolic-disease': 'endocrinology',
};

function makeSource({ id, label, emoji, blurb, subjects, feedBase, siteBase, wordSeparator }) {
  const feedParam = (slug) =>
    FEED_PARAM_OVERRIDES[slug] || slug.replace(/-/g, wordSeparator);

  return {
    id,
    label,
    emoji,
    blurb,

    taxonomy() {
      // Flat: these servers publish subject areas with no parent grouping, and
      // inventing one would be guesswork. One group, rendered without a header.
      return [{
        id: '_all',
        label: null,
        categories: subjects.map((s) => ({
          id: `${id}:${s}`,
          label: titleCase(s, LABEL_OVERRIDES),
          emoji: SUBJECT_EMOJI[s] || emoji,
          code: s,
        })),
      }];
    },

    async fetchAll({ log }) {
      const byId = new Map();

      for (const [i, subject] of subjects.entries()) {
        log(`  [${i + 1}/${subjects.length}] ${subject}`);
        try {
          const xml = await fetchText(`${feedBase}?subject=${encodeURIComponent(feedParam(subject))}`, { log });
          for (const paper of parseRdf(xml, { sourceId: id, category: subject, siteBase })) {
            const prior = byId.get(paper.id);
            if (prior) {
              // A preprint can appear in more than one subject feed; keep both.
              for (const c of paper.categories) {
                if (!prior.categories.includes(c)) prior.categories.push(c);
              }
            } else {
              byId.set(paper.id, paper);
            }
          }
        } catch (err) {
          log(`    FAILED (${err.message})`);
        }
        if (i < subjects.length - 1) await sleep(DELAY_MS);
      }

      return [...byId.values()].sort((a, b) => new Date(b.published) - new Date(a.published));
    },
  };
}

export const biorxiv = makeSource({
  id: 'biorxiv',
  label: 'bioRxiv',
  emoji: '🧬',
  blurb: 'Biology preprints',
  subjects: BIORXIV_SUBJECTS,
  feedBase: 'https://connect.biorxiv.org/biorxiv_xml.php',
  siteBase: 'https://www.biorxiv.org',
  wordSeparator: ' ',
});

export const medrxiv = makeSource({
  id: 'medrxiv',
  label: 'medRxiv',
  emoji: '🩺',
  blurb: 'Health sciences preprints',
  subjects: MEDRXIV_SUBJECTS,
  feedBase: 'https://connect.medrxiv.org/medrxiv_xml.php',
  siteBase: 'https://www.medrxiv.org',
  wordSeparator: '_',
});
