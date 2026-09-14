// claude.js — Claude API integration for AI-powered summaries.
//
// This is a static site with no build step, so it calls the REST API with fetch
// rather than the Anthropic SDK. The key lives only in this browser's
// localStorage and is sent straight to api.anthropic.com.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

// Current models think by default, and thinking tokens count against
// max_tokens — too small a budget and the reply comes back empty.
const MAX_TOKENS = 16000;

const BASE_HEADERS = (apiKey) => ({
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  // Required for browser-side calls; without it the request is blocked by CORS.
  'anthropic-dangerous-direct-browser-access': 'true',
  // Lets the API re-run a declined request on a fallback model in the same call.
  'anthropic-beta': 'server-side-fallback-2026-07-01',
});

export function getApiKey() {
  return localStorage.getItem('paperspark_api_key') || '';
}

export function setApiKey(key) {
  localStorage.setItem('paperspark_api_key', key);
}

export function removeApiKey() {
  localStorage.removeItem('paperspark_api_key');
}

/**
 * Pull the reply text out of a response. The content array can also hold
 * thinking and fallback blocks, so pick the text blocks rather than index 0.
 */
function extractText(data) {
  if (!Array.isArray(data?.content)) return null;
  const text = data.content
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
    .trim();
  return text || null;
}

async function describeError(resp) {
  if (resp.status === 401) return 'Invalid API key';
  if (resp.status === 429) return 'Rate limited — try again shortly';
  if (resp.status === 400) {
    // Surface the real reason (bad model name, credit balance, etc.).
    try {
      const body = await resp.json();
      if (body?.error?.message) return body.error.message;
    } catch { /* fall through to the generic message */ }
  }
  return `API error: ${resp.status}`;
}

/**
 * Generate a concise AI summary of a paper for an undergraduate audience.
 * Returns a string summary, or null if no key is configured.
 */
export async function generateSummary(paper) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const prompt = `You are summarizing a research paper for an undergraduate student. Given the title and abstract below, write a clear, engaging 3-4 sentence summary that:
- Explains what the paper does and why it matters
- Uses simple language (avoid jargon, or briefly explain technical terms)
- Highlights the key finding or contribution
- Makes the reader understand the significance

Do NOT use bullet points. Write flowing prose. Keep it under 100 words.

Title: ${paper.title}

Abstract: ${paper.abstract}

Write only the summary, nothing else.`;

  const resp = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: BASE_HEADERS(apiKey),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Short, routine summarization — low effort keeps latency and cost down.
      output_config: { effort: 'low' },
      fallbacks: 'default',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error(await describeError(resp));

  const data = await resp.json();

  // A safety decline arrives as HTTP 200 with stop_reason "refusal".
  if (data?.stop_reason === 'refusal') {
    throw new Error('Claude declined to summarize this paper');
  }

  return extractText(data);
}

/**
 * Validate an API key with a minimal request.
 * Returns { valid, error } so the caller can explain a failure.
 */
export async function validateApiKey(key) {
  try {
    const resp = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: BASE_HEADERS(key),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        output_config: { effort: 'low' },
        fallbacks: 'default',
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      }),
    });

    if (resp.ok) return { valid: true };
    return { valid: false, error: await describeError(resp) };
  } catch (err) {
    // Network/CORS failure rather than a rejected key.
    return { valid: false, error: err?.message || 'Could not reach the Claude API' };
  }
}
