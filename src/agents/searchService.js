/**
 * Exa.ai search service for real-time web search capability.
 * Provides agents with the ability to search the web during task execution.
 */
import https from 'https';
import { getSearchConfig, updateSearchConfig } from '../utils/config.js';

const DEFAULT_BASE_URL = 'https://api.exa.ai';

/**
 * Execute a web search using Exa.ai
 * @param {string} query - The search query
 * @param {Object} options - Search options
 * @param {number} options.numResults - Number of results (default: 5, max: 10)
 * @param {'keyword'|'neural'|'auto'} options.type - Search type (default: 'auto')
 * @param {boolean} options.contents - Whether to include page contents (default: true)
 * @param {string} options.category - Optional category filter (e.g. 'news', 'research paper', 'company')
 * @returns {Promise<Object>} Search results
 */
export async function exaSearch(query, options = {}) {
  const searchConfig = getSearchConfig();
  const exaConfig = searchConfig?.exa;

  if (!exaConfig?.apiKey) {
    throw new Error('Exa API key not configured. Add it in Settings > Search.');
  }

  const apiKey = exaConfig.apiKey;
  const baseUrl = exaConfig.baseUrl || DEFAULT_BASE_URL;
  const numResults = Math.min(options.numResults || 5, 10);

  const body = {
    query,
    numResults,
    type: options.type || 'auto',
    ...(options.contents !== false && {
      contents: {
        text: { maxCharacters: 1200 }
      }
    }),
    ...(options.category && { category: options.category })
  };

  const url = new URL('/search', baseUrl);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Content-Length': Buffer.byteLength(postData)
      },
      rejectUnauthorized: false
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(formatResults(parsed, query));
          } catch (e) {
            reject(new Error(`Failed to parse Exa response: ${e.message}`));
          }
        } else if (res.statusCode === 429) {
          reject(new Error('Exa rate limit exceeded. Please wait before searching again.'));
        } else if (res.statusCode === 401) {
          reject(new Error('Invalid Exa API key. Check your configuration.'));
        } else {
          reject(new Error(`Exa search failed (${res.statusCode}): ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Exa search request failed: ${e.message}`)));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Exa search timed out after 15 seconds'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Format Exa results into a clean, LLM-friendly structure
 */
function formatResults(raw, query) {
  const results = (raw.results || []).map((r, i) => ({
    position: i + 1,
    title: r.title || 'Untitled',
    url: r.url || '',
    publishedDate: r.publishedDate || null,
    text: r.text || '',
    score: r.score || null
  }));

  return {
    query,
    resultCount: results.length,
    results
  };
}

/**
 * Format search results into a text block suitable for injecting into an LLM prompt
 * @param {Object} searchData - The formatted search results from exaSearch()
 * @returns {string} A text summary of the results
 */
export function formatResultsForPrompt(searchData) {
  if (!searchData || !searchData.results || searchData.results.length === 0) {
    return `[Web search for "${searchData?.query || 'unknown'}" returned no results.]`;
  }

  const lines = [`Web search results for: "${searchData.query}"\n`];

  for (const r of searchData.results) {
    lines.push(`[${r.position}] ${r.title}`);
    lines.push(`    URL: ${r.url}`);
    if (r.publishedDate) {
      lines.push(`    Date: ${r.publishedDate}`);
    }
    if (r.text) {
      // Truncate individual result text to keep prompt manageable
      const trimmed = r.text.length > 800 ? r.text.substring(0, 800) + '…' : r.text;
      lines.push(`    Content: ${trimmed}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Perform a search and return the prompt-ready text directly.
 * Convenience wrapper combining exaSearch + formatResultsForPrompt.
 * @param {string} query
 * @param {Object} options
 * @returns {Promise<string>}
 */
export async function searchForPrompt(query, options = {}) {
  const data = await exaSearch(query, options);
  return formatResultsForPrompt(data);
}

/**
 * Check whether search is configured and available.
 * @returns {boolean}
 */
export function isSearchConfigured() {
  const cfg = getSearchConfig();
  return !!(cfg?.exa?.apiKey);
}

export default {
  exaSearch,
  formatResultsForPrompt,
  searchForPrompt,
  isSearchConfigured
};
