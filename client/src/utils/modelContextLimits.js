/**
 * Context window sizes (in tokens) for common models.
 * Matched by substring against the lower-cased model identifier.
 * Entries are checked in order — put more-specific patterns first.
 */
const CONTEXT_LIMITS = [
  // OpenAI
  { pattern: 'gpt-4o-mini',         tokens: 128_000 },
  { pattern: 'gpt-4o',              tokens: 128_000 },
  { pattern: 'gpt-4-turbo',         tokens: 128_000 },
  { pattern: 'gpt-4-32k',           tokens: 32_768  },
  { pattern: 'gpt-4',               tokens: 8_192   },
  { pattern: 'gpt-3.5-turbo-16k',   tokens: 16_385  },
  { pattern: 'gpt-3.5-turbo',       tokens: 16_385  },
  { pattern: 'o1-mini',             tokens: 128_000 },
  { pattern: 'o1-pro',              tokens: 200_000 },
  { pattern: 'o1',                  tokens: 200_000 },
  { pattern: 'o3-mini',             tokens: 200_000 },
  { pattern: 'o3',                  tokens: 200_000 },
  { pattern: 'o4-mini',             tokens: 200_000 },
  // Anthropic
  { pattern: 'claude-3-opus',       tokens: 200_000 },
  { pattern: 'claude-3-sonnet',     tokens: 200_000 },
  { pattern: 'claude-3-haiku',      tokens: 200_000 },
  { pattern: 'claude-3.5-sonnet',   tokens: 200_000 },
  { pattern: 'claude-3.5-haiku',    tokens: 200_000 },
  { pattern: 'claude-4',            tokens: 200_000 },
  { pattern: 'claude',              tokens: 100_000 },
  // Google
  { pattern: 'gemini-2.0-flash',    tokens: 1_048_576 },
  { pattern: 'gemini-1.5-pro',      tokens: 2_000_000 },
  { pattern: 'gemini-1.5-flash',    tokens: 1_000_000 },
  { pattern: 'gemini-pro',          tokens: 32_760   },
  { pattern: 'gemini',              tokens: 128_000  },
  // Meta Llama
  { pattern: 'llama-3.3',           tokens: 128_000 },
  { pattern: 'llama-3.2',           tokens: 128_000 },
  { pattern: 'llama-3.1',           tokens: 128_000 },
  { pattern: 'llama-3',             tokens: 8_192   },
  { pattern: 'llama',               tokens: 4_096   },
  // Mistral
  { pattern: 'mistral-large',       tokens: 128_000 },
  { pattern: 'mistral-small',       tokens: 32_768  },
  { pattern: 'mixtral',             tokens: 32_768  },
  { pattern: 'mistral',             tokens: 32_768  },
  // DeepSeek
  { pattern: 'deepseek-r1',         tokens: 64_000  },
  { pattern: 'deepseek',            tokens: 64_000  },
  // Qwen
  { pattern: 'qwen3',               tokens: 128_000 },
  { pattern: 'qwen2.5',             tokens: 128_000 },
  { pattern: 'qwen',                tokens: 32_768  },
  // Arcee / Trinity
  { pattern: 'trinity',             tokens: 32_768  },
  { pattern: 'arcee',               tokens: 32_768  },
  // Groq-hosted
  { pattern: 'groq',                tokens: 32_768  },
  // Others
  { pattern: 'gemma-2',             tokens: 8_192   },
  { pattern: 'gemma',               tokens: 8_192   },
  { pattern: 'phi-3',               tokens: 128_000 },
  { pattern: 'phi',                 tokens: 16_384  },
  { pattern: 'seed-oss',            tokens: 65_536  },
  { pattern: 'minimax',             tokens: 65_536  },
  { pattern: 'cohere',              tokens: 128_000 },
];

/** Default fallback when no pattern matches */
const DEFAULT_CONTEXT_LIMIT = 32_768;

/**
 * Returns the context window size in tokens for the given model identifier.
 * Falls back to DEFAULT_CONTEXT_LIMIT if no pattern matches.
 *
 * @param {string} modelId - The model identifier string (e.g. "gpt-4o", "arcee-ai/trinity-large-preview:free")
 * @returns {number} Context window size in tokens
 */
export function getContextLimit(modelId) {
  if (!modelId) return DEFAULT_CONTEXT_LIMIT;
  const lower = modelId.toLowerCase();
  for (const entry of CONTEXT_LIMITS) {
    if (lower.includes(entry.pattern)) return entry.tokens;
  }
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * Formats a large token count for display (e.g. 128000 → "128k").
 */
export function formatContextLimit(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000)     return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}
