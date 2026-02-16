// Configuration management for the multi-agent system

// In-memory storage for API configuration (not persisted)
let config = {
  apiKey: process.env.OPENAI_API_KEY || null,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
};

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
}

export default {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getModel,
  setModel,
  hasApiKey,
  getConfig,
  updateConfig
};
