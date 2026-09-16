// hfpapers.mjs — Hugging Face Daily Papers.
//
// The curated counterpart to the arXiv firehose: a hand-picked set of AI
// papers each day, carrying community upvotes and machine-extracted keywords.
// Everything here is an arXiv paper, so each one also declares a dedupeKey and
// the feed collapses it against the same paper arriving from the arXiv source.
//
// HF publishes no topic taxonomy for these, and its 1400+ ai_keywords are far
// too granular to be categories, so papers are bucketed into the AI areas the
// keyword distribution actually shows.

import { fetchJson, toIso, sleep } from '../lib/common.mjs';

const API = 'https://huggingface.co/api/daily_papers';
const DAYS = 14;         // ~20 papers a day, enough to fill the buckets
const PAGE = 100;
const DELAY_MS = 400;
const TRENDING_COUNT = 30;
const TRENDING_MIN_UPVOTES = 8;

// Ordered: the first matching bucket wins for labelling, but a paper is filed
// under every bucket it matches, the way an arXiv paper cross-lists.
const TOPICS = [
  {
    id: 'agents', label: 'Agents & Tool Use', emoji: '🤖',
    patterns: ['agent', 'agentic', 'tool use', 'tool call', 'function call', 'computer use',
      'web browsing', 'browser', 'multi-agent', 'workflow', 'orchestrat'],
  },
  {
    id: 'reasoning', label: 'Reasoning & Test-Time Compute', emoji: '🧠',
    patterns: ['reasoning', 'chain-of-thought', 'chain of thought', 'cot', 'test-time',
      'test time compute', 'self-consistency', 'verifier', 'theorem', 'math word problem',
      'deliberat', 'planning', 'search at inference'],
  },
  {
    id: 'rl-post-training', label: 'RL & Post-Training', emoji: '🎯',
    patterns: ['reinforcement learning', 'rlhf', 'rlvr', 'grpo', 'dpo', 'ppo', 'reward model',
      'preference optimization', 'fine-tuning', 'finetuning', 'sft', 'supervised fine',
      'post-training', 'distillation', 'self-improvement', 'curriculum'],
  },
  {
    id: 'multimodal', label: 'Multimodal & Vision-Language', emoji: '👁️',
    patterns: ['multimodal', 'vision-language', 'vision language', 'vlm', 'mllm',
      'image understanding', 'video understanding', 'visual question', 'ocr', 'document understanding',
      'cross-attention', 'image-text'],
  },
  {
    id: 'generative', label: 'Generative Media', emoji: '🎨',
    patterns: ['diffusion', 'text-to-image', 'text-to-video', 'text-to-speech', 'image generation',
      'video generation', 'flow matching', 'gan', 'rectified flow', 'audio generation',
      'speech synthesis', 'voice clon', 'music generation', '3d generation', 'avatar'],
  },
  {
    id: 'efficiency', label: 'Efficiency & Inference', emoji: '⚡',
    patterns: ['quantization', 'pruning', 'sparsity', 'kv cache', 'speculative decoding',
      'mixture-of-experts', 'mixture of experts', 'moe', 'inference', 'serving', 'throughput',
      'latency', 'long context', 'linear attention', 'flash attention', 'compression', 'distributed training'],
  },
  {
    id: 'robotics', label: 'Robotics & Embodied AI', emoji: '🦾',
    patterns: ['robot', 'embodied', 'manipulation', 'navigation', 'vision-language-action', 'vla',
      'world model', 'sim-to-real', 'locomotion', 'grasp', 'autonomous driving'],
  },
  {
    id: 'retrieval', label: 'Retrieval & Memory', emoji: '🔎',
    patterns: ['retrieval', 'rag', 'retrieval-augmented', 'knowledge base', 'vector database',
      'embedding model', 'memory', 'knowledge graph', 'context management'],
  },
  {
    id: 'safety', label: 'Safety & Alignment', emoji: '🛡️',
    patterns: ['safety', 'alignment', 'jailbreak', 'red team', 'adversarial', 'hallucination',
      'watermark', 'privacy', 'toxicity', 'bias', 'guardrail', 'interpretab', 'unlearning',
      'sandbagging', 'deception'],
  },
  {
    id: 'benchmarks', label: 'Benchmarks & Evaluation', emoji: '📊',
    patterns: ['benchmark', 'evaluation', 'eval suite', 'leaderboard', 'dataset', 'corpus',
      'annotation', 'human study', 'llm-as-a-judge', 'llm as a judge'],
  },
  {
    id: 'llm', label: 'LLMs & Architectures', emoji: '🗣️',
    patterns: ['large language model', 'llm', 'language model', 'transformer', 'pretraining',
      'pre-training', 'tokenizer', 'tokenization', 'next-token', 'scaling law', 'attention',
      'state space', 'mamba', 'context window', 'in-context learning'],
  },
];

const OTHER = { id: 'other', label: 'Other AI Research', emoji: '🔬' };
const TRENDING = { id: 'trending', label: 'Trending', emoji: '🔥' };

// Word-boundary matching so short tokens ("rl", "moe", "vlm", "gan") don't fire
// inside unrelated words.
const compiled = TOPICS.map((t) => ({
  ...t,
  re: new RegExp('(?:^|[^a-z0-9])(?:' + t.patterns.map(escapeRe).join('|') + ')(?:[^a-z0-9]|$)', 'i'),
}));

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bucketsFor(paper) {
  const haystack = [
    paper.title,
    paper.abstract,
    (paper.keywords || []).join(' '),
  ].join(' \n ').toLowerCase();

  const hits = compiled.filter((t) => t.re.test(haystack)).map((t) => t.id);
  return hits.length ? hits : [OTHER.id];
}

function parseEntry(entry) {
  const p = entry?.paper;
  if (!p?.id || !p.title || !p.summary) return null;

  const arxivId = String(p.id).replace(/v\d+$/, '');

  return {
    id: 'hfpapers:' + arxivId,
    // These are arXiv papers; let the feed collapse them against the arXiv
    // source rather than showing the same paper twice.
    dedupeKey: 'arxiv:' + arxivId,
    source: 'hfpapers',
    title: String(p.title).replace(/\s+/g, ' ').trim(),
    authors: (p.authors || []).map((a) => a.name).filter(Boolean),
    abstract: String(p.summary).replace(/\s+/g, ' ').trim(),
    keywords: p.ai_keywords || [],
    upvotes: p.upvotes || 0,
    categories: [],
    published: toIso(p.publishedAt || entry.publishedAt),
    updated: toIso(entry.publishedAt || p.publishedAt),
    pdfUrl: 'https://arxiv.org/pdf/' + arxivId,
    url: 'https://huggingface.co/papers/' + arxivId,
  };
}

export default {
  id: 'hfpapers',
  label: 'Hugging Face',
  emoji: '🤗',
  blurb: 'Trending AI papers, curated daily',

  taxonomy() {
    return [{
      id: '_all',
      label: null,
      categories: [TRENDING, ...TOPICS, OTHER].map((t) => ({
        id: 'hfpapers:' + t.id,
        label: t.label,
        emoji: t.emoji,
        code: t.id,
      })),
    }];
  },

  async fetchAll({ log }) {
    const byId = new Map();

    for (let i = 0; i < DAYS; i++) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      try {
        const entries = await fetchJson(`${API}?date=${date}&limit=${PAGE}`, { log });
        let added = 0;
        for (const entry of entries) {
          const paper = parseEntry(entry);
          if (!paper || byId.has(paper.id)) continue;
          byId.set(paper.id, paper);
          added++;
        }
        log(`  [${i + 1}/${DAYS}] ${date}: ${added} papers`);
      } catch (err) {
        log(`  [${i + 1}/${DAYS}] ${date}: FAILED (${err.message})`);
      }
      if (i < DAYS - 1) await sleep(DELAY_MS);
    }

    const papers = [...byId.values()];

    for (const paper of papers) {
      paper.categories = bucketsFor(paper).map((id) => 'hfpapers:' + id);
    }

    // "Trending" is the whole point of this source: the papers the community
    // actually pushed to the top, regardless of topic.
    const trending = papers
      .filter((p) => p.upvotes >= TRENDING_MIN_UPVOTES)
      .sort((a, b) => b.upvotes - a.upvotes)
      .slice(0, TRENDING_COUNT);
    for (const paper of trending) paper.categories.unshift('hfpapers:trending');

    log(`  ${papers.length} papers, ${trending.length} trending (top upvotes: ${trending[0]?.upvotes ?? 0})`);

    return papers.sort((a, b) => new Date(b.published) - new Date(a.published));
  },
};
