// common.mjs — helpers shared by the per-source fetchers.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const USER_AGENT =
  'PaperSpark/1.0 (+https://github.com/nonidino/paperspark; mailto:nonidino@gmail.com)';

// Some hosts (NBER) serve a different page to non-browser agents.
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * GET with retries and exponential backoff. Returns the response body as text.
 */
export async function fetchText(url, { attempts = 3, timeout = 60000, ua = USER_AGENT, log } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': ua },
        signal: AbortSignal.timeout(timeout),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.text();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      const backoff = 3000 * Math.pow(3, attempt); // 9s, 27s
      log?.(`    retry after ${err.message} (waiting ${backoff / 1000}s)`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

// --- XML / HTML text handling ---

export function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Strip CDATA wrappers, tags and entities, then collapse whitespace. */
export function clean(s) {
  return decodeEntities(
    String(s)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

// Built with string concatenation rather than template literals so the
// backslashes in the character classes survive verbatim.
export function tagRe(tag, flags) {
  return new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', flags);
}

export function tagText(xml, tag) {
  const m = xml.match(tagRe(tag));
  return m ? clean(m[1]) : '';
}

export function allTagText(xml, tag) {
  const out = [];
  const re = tagRe(tag, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(clean(m[1]));
  return out;
}

export function blocks(xml, tag) {
  // Matches <item ...> ... </item> as well as bare <item>, which RDF feeds use.
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

// --- Misc ---

/** Filesystem- and URL-safe slug, used for category ids and data filenames. */
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** "neuroscience" -> "Neuroscience", "hiv-aids" -> "HIV/AIDS" handled by overrides. */
export function titleCase(slug, overrides = {}) {
  if (overrides[slug]) return overrides[slug];
  return slug
    .split('-')
    .map((w) => (w.length <= 2 && w !== 'ai' ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOf\b/g, 'of')
    .replace(/\bThe\b/g, 'the');
}

export function toIso(value) {
  if (!value) return new Date().toISOString();
  const t = Date.parse(value);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}
