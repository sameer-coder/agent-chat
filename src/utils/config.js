// Configuration management for the multi-agent system
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_DIR = join(__dirname, '..', '..', 'data');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Default shape for the persisted config file.
 */
function defaultFileConfig() {
  return {
    activeProvider: 'openai',
    providers: [
      {
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
        recentModels: ['gpt-4o-mini']
      }
    ]
  };
}

/**
 * Find a provider entry by name in the providers array.
 */
function findProvider(data, name) {
  return (data.providers || []).find(p => p.name === name) || null;
}

/**
 * Find a provider entry by baseUrl in the providers array.
 */
function findProviderByUrl(data, baseUrl) {
  const key = deriveProviderKey(baseUrl);
  return (data.providers || []).find(p => p.name === key) || null;
}

/**
 * Get the currently active provider object (or the first one).
 */
function getActiveProvider(data) {
  const active = findProvider(data, data.activeProvider);
  if (active) return active;
  return (data.providers || [])[0] || null;
}

/**
 * Push a model to the front of a provider's recentModels list (max 3, no dupes).
 */
function pushRecentModel(provider, model) {
  if (!model) return;
  const list = Array.isArray(provider.recentModels) ? provider.recentModels.slice() : [];
  const idx = list.indexOf(model);
  if (idx !== -1) list.splice(idx, 1);
  list.unshift(model);
  provider.recentModels = list.slice(0, 3);
}

/**
 * Read config from CONFIG_JSON env var, disk file, or defaults (in that priority).
 * Handles migration from the legacy flat apiKeys/models format.
 */
function readConfigFile() {
  let parsed = null;

  // 1) CONFIG_JSON env var takes top priority (Railway / cloud deploys)
  if (process.env.CONFIG_JSON) {
    try {
      let raw = process.env.CONFIG_JSON.trim();
      // Railway's ENV editor sometimes wraps the value in outer quotes
      if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
        raw = raw.slice(1, -1);
      }
      // Railway's Raw Editor may show escaped quotes (\") — unescape them
      if (raw.includes('\\"') && !raw.includes('{"')) {
        raw = raw.replace(/\\"/g, '"');
      }
      parsed = JSON.parse(raw);
      console.log(`CONFIG_JSON parsed OK – activeProvider: ${parsed.activeProvider}, providers: ${(parsed.providers || []).length}`);
    } catch (e) {
      console.error('CONFIG_JSON env var is not valid JSON:', e.message);
      console.error('CONFIG_JSON raw value (first 200 chars):', process.env.CONFIG_JSON.substring(0, 200));
      // fall through to disk / defaults
    }
  }

  // 2) Fall back to disk file
  if (!parsed) {
    try {
      if (existsSync(CONFIG_FILE)) {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        parsed = JSON.parse(raw);
      }
    } catch (e) {
      console.error('Failed to read config file:', e.message);
    }
  }

  if (!parsed) return defaultFileConfig();

  try {

    // ── Legacy migration: convert flat apiKeys/models to providers array ──
    if (parsed.apiKeys && !parsed.providers) {
      const providers = [];
      for (const [name, apiKey] of Object.entries(parsed.apiKeys)) {
        providers.push({
          name,
          baseUrl: guessBaseUrl(name),
          apiKey: apiKey || '',
          model: (parsed.models && parsed.models[name]) || ''
        });
      }
      const activeKey = deriveProviderKey(parsed.baseUrl || 'https://api.openai.com/v1');
      return {
        activeProvider: activeKey,
        providers: providers.length ? providers : defaultFileConfig().providers,
        ...(parsed.search ? { search: parsed.search } : {})
      };
    }

    // Already in new format
    return {
      activeProvider: parsed.activeProvider || defaultFileConfig().activeProvider,
      providers: Array.isArray(parsed.providers) && parsed.providers.length
        ? parsed.providers
        : defaultFileConfig().providers,
      ...(parsed.search ? { search: parsed.search } : {})
    };
  } catch (e) {
    console.error('Failed to parse config data, using defaults:', e.message);
  }
  return defaultFileConfig();
}

/**
 * Best-effort guess of a base URL from a provider name (used during migration).
 */
function guessBaseUrl(providerName) {
  const map = {
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    deepseek: 'https://api.deepseek.com/v1',
    askcodi: 'https://api.askcodi.com/v1',
    ollama: 'http://localhost:11434/v1',
    lmstudio: 'http://localhost:1234/v1'
  };
  return map[providerName] || `https://${providerName}.example.com/v1`;
}

/**
 * Write the full config object to disk.
 */
function writeConfigFile(data) {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write config file:', e.message);
  }
}

// ── Active in-memory config (loaded from file on startup) ──

// readConfigFile() now checks CONFIG_JSON env var first, then disk, then defaults.
const fileData = readConfigFile();

// Best-effort: seed data/config.json on disk so runtime changes can be persisted.
// On Railway this may be ephemeral, which is fine — CONFIG_JSON is always re-read.
try {
  if (!existsSync(CONFIG_FILE)) {
    writeConfigFile(fileData);
    console.log(`Created default config file at ${CONFIG_FILE}`);
  }
} catch (e) {
  console.warn('Could not write initial config file (read-only FS?):', e.message);
}

if (process.env.CONFIG_JSON) {
  console.log('CONFIG_JSON env var detected — using it as primary config source');
}

const activeProvider = getActiveProvider(fileData);

let config = {
  apiKey: process.env.OPENAI_API_KEY || (activeProvider ? activeProvider.apiKey : null),
  baseUrl: process.env.OPENAI_BASE_URL || (activeProvider ? activeProvider.baseUrl : 'https://api.openai.com/v1'),
  model: process.env.OPENAI_MODEL || (activeProvider ? activeProvider.model : 'gpt-4o-mini')
};

/**
 * Derive a short provider key from a base URL (same logic used by the frontend).
 */
function deriveProviderKey(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname.includes('openrouter')) return 'openrouter';
    if (hostname.includes('deepseek')) return 'deepseek';
    if (hostname.includes('nvidia')) return 'nvidia';
    if (hostname.includes('strongwall')) return 'strongwall';
    if (hostname.includes('groq')) return 'groq';
    if (hostname.includes('askcodi')) return 'askcodi';
    if (hostname.includes('ollama')) return 'ollama';
    if (hostname.includes('lmstudio')) return 'lmstudio';
    if (hostname.includes('openai')) return 'openai';
    return hostname;
  } catch (e) { return 'custom'; }
}

/**
 * Get the current API key
 * @returns {string|null} The API key or null
 */
export function getApiKey() {
  return config.apiKey;
}

/**
 * Set the API key
 * @param {string} key - The OpenAI API key
 */
export function setApiKey(key) {
  config.apiKey = key;
}

/**
 * Get the API base URL
 * @returns {string} The base URL
 */
export function getBaseUrl() {
  return config.baseUrl;
}

/**
 * Set the API base URL
 * @param {string} url - The base URL for the API
 */
export function setBaseUrl(url) {
  config.baseUrl = url;
}

/**
 * Get the model name
 * @returns {string} The model name
 */
export function getModel() {
  return config.model;
}

/**
 * Set the model name
 * @param {string} model - The model name
 */
export function setModel(model) {
  config.model = model;
}

/**
 * Check if API key is configured
 * @returns {boolean} Whether API key is available
 */
export function hasApiKey() {
  return config.apiKey !== null && config.apiKey.length > 0;
}

/**
 * Check whether a base URL points to a locally hosted provider.
 * @param {string} baseUrl
 * @returns {boolean}
 */
export function isLocalProviderBaseUrl(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch (e) {
    return false;
  }
}

/**
 * A provider is usable when it has an API key OR it is locally hosted.
 * @returns {boolean}
 */
export function hasProviderAccess() {
  return hasApiKey() || isLocalProviderBaseUrl(config.baseUrl);
}

/**
 * Get all configuration
 * @returns {Object} Current configuration
 */
export function getConfig() {
  return {
    apiKey: config.apiKey ? '***configured***' : null,
    baseUrl: config.baseUrl,
    model: config.model
  };
}

/**
 * Update configuration
 * @param {Object} newConfig - New configuration values
 */
export function updateConfig(newConfig) {
  if (newConfig.apiKey !== undefined && newConfig.apiKey.trim()) {
    config.apiKey = newConfig.apiKey.trim();
  }
  if (newConfig.baseUrl !== undefined && newConfig.baseUrl.trim()) {
    config.baseUrl = newConfig.baseUrl.trim();
  }
  if (newConfig.model !== undefined && newConfig.model.trim()) {
    config.model = newConfig.model.trim();
  }
  // Persist active provider to the JSON file
  persistCurrentProvider();
}

/**
 * Persist the current active config into the providers array on disk.
 */
function persistCurrentProvider() {
  const data = readConfigFile();
  const providerKey = deriveProviderKey(config.baseUrl);
  data.activeProvider = providerKey;

  const existing = findProvider(data, providerKey);
  if (existing) {
    existing.baseUrl = config.baseUrl;
    existing.model = config.model;
    if (config.apiKey) existing.apiKey = config.apiKey;
    pushRecentModel(existing, config.model);
  } else {
    data.providers = data.providers || [];
    data.providers.push({
      name: providerKey,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey || '',
      model: config.model,
      recentModels: config.model ? [config.model] : []
    });
  }
  writeConfigFile(data);
}

// ─── Provider-config helpers (used by server.js API routes) ───

/**
 * Get the full persisted provider config (safe for sending to frontend).
 * API keys are masked.
 */
export function getProviderConfig() {
  const data = readConfigFile();
  return {
    activeProvider: data.activeProvider,
    providers: (data.providers || []).map(p => ({
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey ? '***configured***' : null,
      model: p.model,
      recentModels: Array.isArray(p.recentModels) ? p.recentModels : []
    }))
  };
}

/**
 * Get the full persisted provider config with real API keys (internal only).
 */
export function getProviderConfigRaw() {
  return readConfigFile();
}

/**
 * List all provider names from the config.
 */
export function listProviders() {
  const data = readConfigFile();
  return (data.providers || []).map(p => p.name);
}

/**
 * Save per-provider data from the frontend.
 * @param {Object} incoming - { baseUrl, model, apiKey }
 */
export function saveProviderConfig(incoming) {
  const data = readConfigFile();
  const baseUrl = (incoming.baseUrl || 'https://api.openai.com/v1').trim();
  const model = (incoming.model || 'gpt-4o-mini').trim();
  const apiKey = (incoming.apiKey || '').trim();
  const providerKey = deriveProviderKey(baseUrl);

  data.providers = data.providers || [];
  const existing = findProvider(data, providerKey);
  if (existing) {
    existing.baseUrl = baseUrl;
    existing.model = model;
    if (apiKey) existing.apiKey = apiKey;
    pushRecentModel(existing, model);
  } else {
    data.providers.push({
      name: providerKey,
      baseUrl,
      apiKey,
      model,
      recentModels: model ? [model] : []
    });
  }
  data.activeProvider = providerKey;

  writeConfigFile(data);

  // Also update the active in-memory config
  config.baseUrl = baseUrl;
  config.model = model;
  if (apiKey) config.apiKey = apiKey;
}

/**
 * Load API key for a specific provider from the persisted file.
 */
export function loadApiKeyForProvider(baseUrl) {
  const data = readConfigFile();
  const provider = findProviderByUrl(data, baseUrl);
  return provider ? provider.apiKey || null : null;
}

/**
 * Load model for a specific provider from the persisted file.
 */
export function loadModelForProvider(baseUrl) {
  const data = readConfigFile();
  const provider = findProviderByUrl(data, baseUrl);
  return provider ? provider.model || null : null;
}

/**
 * Load recent models list for a specific provider from the persisted file.
 */
export function loadRecentModelsForProvider(baseUrl) {
  const data = readConfigFile();
  const provider = findProviderByUrl(data, baseUrl);
  return provider && Array.isArray(provider.recentModels) ? provider.recentModels : [];
}

// ─── Search config helpers ───

/**
 * Get the search configuration section from the persisted config.
 * @returns {Object|null}
 */
export function getSearchConfig() {
  const data = readConfigFile();
  return data.search || null;
}

/**
 * Update the search configuration section and persist to disk.
 * @param {Object} searchCfg - e.g. { provider: 'exa', exa: { apiKey: '...', baseUrl: '...' } }
 */
export function updateSearchConfig(searchCfg) {
  const data = readConfigFile();
  data.search = { ...(data.search || {}), ...searchCfg };
  writeConfigFile(data);
}

export default {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getModel,
  setModel,
  hasApiKey,
  isLocalProviderBaseUrl,
  hasProviderAccess,
  getConfig,
  updateConfig,
  getProviderConfig,
  getProviderConfigRaw,
  saveProviderConfig,
  loadApiKeyForProvider,
  loadModelForProvider,
  loadRecentModelsForProvider,
  listProviders,
  getSearchConfig,
  updateSearchConfig
};
