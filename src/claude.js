// claude.js — Claude API integration for AI-powered summaries

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

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
 * Generate a concise AI summary of a paper for an undergraduate audience.
 * Returns a string summary.
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

  try {
    const resp = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!resp.ok) {
      if (resp.status === 401) throw new Error('Invalid API key');
      throw new Error(`API error: ${resp.status}`);
    }

    const data = await resp.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('Claude API error:', err);
    throw err;
  }
}

/**
 * Validate an API key with a minimal request
 */
export async function validateApiKey(key) {
  try {
    const resp = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Say ok' }]
      })
    });
    return resp.ok;
  } catch {
    return false;
  }
}
