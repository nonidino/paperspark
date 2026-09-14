// deepseek.js — DeepSeek API integration for AI-powered summaries.
//
// This is a static site with no build step, so it calls the REST API with
// fetch rather than an SDK. DeepSeek's API is OpenAI-compatible and sends CORS
// headers, so the browser can call it directly. The key lives only in this
// browser's localStorage and is sent straight to api.deepseek.com.

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// deepseek-chat (V3) rather than deepseek-reasoner (R1): a 100-word plain
// summary doesn't need a reasoning model, and V3 is faster and cheaper.
const MODEL = 'deepseek-chat';
const MAX_TOKENS = 600;

const KEY_STORAGE = 'paperspark_deepseek_key';
const LEGACY_KEY_STORAGE = 'paperspark_api_key'; // Anthropic key from earlier versions

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

export function setApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key);
}

export function removeApiKey() {
  localStorage.removeItem(KEY_STORAGE);
}

/**
 * Drop the Anthropic key older versions stored. It is useless to DeepSeek and
 * shouldn't sit in localStorage.
 */
export function clearLegacyKey() {
  try { localStorage.removeItem(LEGACY_KEY_STORAGE); } catch { /* ignore */ }
}

function buildHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * Pull the reply text out of a response. On deepseek-reasoner the chain of
 * thought arrives separately as reasoning_content, so content is the answer
 * either way.
 */
function extractText(data) {
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

async function describeError(resp) {
  if (resp.status === 401) return 'Invalid API key';
  if (resp.status === 402) return 'DeepSeek account is out of credit';
  if (resp.status === 429) return 'Rate limited — try again shortly';

  // Surface the real reason for anything else DeepSeek explains.
  try {
    const body = await resp.json();
    if (body?.error?.message) return body.error.message;
  } catch { /* fall through to the generic message */ }

  if (resp.status === 503) return 'DeepSeek is busy — try again shortly';
  return `API error: ${resp.status}`;
}

async function postChat(apiKey, body) {
  return fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model: MODEL, stream: false, ...body }),
  });
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

  const resp = await postChat(apiKey, {
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  if (!resp.ok) throw new Error(await describeError(resp));

  return extractText(await resp.json());
}

/**
 * Validate an API key with a minimal request.
 * Returns { valid, error } so the caller can explain a failure.
 */
export async function validateApiKey(key) {
  try {
    const resp = await postChat(key, {
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    });

    if (resp.ok) return { valid: true };
    return { valid: false, error: await describeError(resp) };
  } catch (err) {
    // Network/CORS failure rather than a rejected key.
    return { valid: false, error: err?.message || 'Could not reach the DeepSeek API' };
  }
}
