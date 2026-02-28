import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { createMasterHandler } from './src/agents/index.js';
import { exaSearch, isSearchConfigured } from './src/agents/searchService.js';
import { getApiKey, setApiKey, hasApiKey, hasProviderAccess, isLocalProviderBaseUrl, getConfig, updateConfig, getProviderConfig, getProviderConfigRaw, saveProviderConfig, loadApiKeyForProvider, loadModelForProvider, loadRecentModelsForProvider, getSearchConfig, updateSearchConfig } from './src/utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({ logger: true });

function parsePrice(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreeOpenRouterModel(model) {
  const id = typeof model?.id === 'string' ? model.id.toLowerCase() : '';
  if (id.endsWith(':free')) {
    return true;
  }

  const pricing = model?.pricing || {};
  const prices = [
    parsePrice(pricing.prompt),
    parsePrice(pricing.completion),
    parsePrice(pricing.request),
    parsePrice(pricing.image)
  ].filter((price) => price !== null);

  return prices.length > 0 && prices.every((price) => price === 0);
}

// Serve the React build (client/dist) if it exists, otherwise fall back to public/
const clientDistPath = join(__dirname, 'client', 'dist');
const publicPath = join(__dirname, 'public');
const staticRoot = existsSync(clientDistPath) ? clientDistPath : publicPath;

// Register plugins
await fastify.register(fastifyStatic, {
  root: staticRoot,
  prefix: '/'
});

await fastify.register(fastifyWebsocket);

// Track connected clients
const clients = new Set();

// Map each socket to its currently-running MasterHandler so we can stop it
const activeHandlers = new Map();

// Health check endpoint
fastify.get('/api/health', async (request, reply) => {
  const config = getConfig();
  return { 
    status: 'ok', 
    apiConfigured: hasProviderAccess(),
    baseUrl: config.baseUrl,
    model: config.model,
    configSource: process.env.CONFIG_JSON ? 'CONFIG_JSON env var' : 'disk file'
  };
});

// API configuration endpoint
fastify.post('/api/config', async (request, reply) => {
  const { apiKey, baseUrl, model } = request.body;
  const resolvedBaseUrl = (baseUrl || 'https://api.openai.com/v1').trim();
  const isLocalProvider = isLocalProviderBaseUrl(resolvedBaseUrl);
  
  if (!isLocalProvider && (!apiKey || typeof apiKey !== 'string')) {
    return reply.status(400).send({ error: 'API key is required' });
  }
  
  updateConfig({
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    baseUrl: resolvedBaseUrl,
    model
  });
  
  const config = getConfig();
  return { 
    success: true, 
    message: 'API configured successfully',
    baseUrl: config.baseUrl,
    model: config.model
  };
});

// Get current config endpoint
fastify.get('/api/config', async (request, reply) => {
  const config = getConfig();
  return config;
});

// Get full provider config (per-provider keys + models, keys masked)
fastify.get('/api/provider-config', async (request, reply) => {
  return getProviderConfig();
});

// Get raw provider config including real API keys for a specific provider
fastify.get('/api/provider-config/key', async (request, reply) => {
  const { baseUrl } = request.query;
  if (!baseUrl) {
    return reply.status(400).send({ error: 'baseUrl query parameter is required' });
  }
  const apiKey = loadApiKeyForProvider(baseUrl);
  const model = loadModelForProvider(baseUrl);
  const recentModels = loadRecentModelsForProvider(baseUrl);
  return { apiKey: apiKey || '', model: model || '', recentModels };
});

// Save provider config
fastify.post('/api/provider-config', async (request, reply) => {
  const { apiKey, baseUrl, model } = request.body;
  saveProviderConfig({ apiKey, baseUrl, model });
  return { success: true };
});

// Get latest OpenRouter models
fastify.get('/api/openrouter/models', async (request, reply) => {
  try {
    const apiKeyHeader = request.headers['x-openrouter-api-key'];
    const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader.trim() : '';

    const headers = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Multi-Agent Dashboard'
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      return reply.status(response.status).send({
        error: `Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`,
        details: errorText
      });
    }

    const payload = await response.json();
    const models = Array.isArray(payload?.data) ? payload.data : [];

    const normalizedModels = models
      .filter((model) => typeof model?.id === 'string')
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        contextLength: model.context_length ?? null,
        pricing: model.pricing || {},
        isFree: isFreeOpenRouterModel(model)
      }));

    return {
      success: true,
      models: normalizedModels,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    return reply.status(502).send({
      error: 'Failed to fetch OpenRouter models',
      details: error.message
    });
  }
});

// Get latest AskCodi models
fastify.get('/api/askcodi/models', async (request, reply) => {
  try {
    const apiKeyHeader = request.headers['x-askcodi-api-key'];
    const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader.trim() : '';

    const headers = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Multi-Agent Dashboard'
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://api.askcodi.com/v1/models', {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      return reply.status(response.status).send({
        error: `Failed to fetch AskCodi models: ${response.status} ${response.statusText}`,
        details: errorText
      });
    }

    const payload = await response.json();
    const models = Array.isArray(payload?.data) ? payload.data : [];

    const normalizedModels = models
      .filter((model) => typeof model?.id === 'string')
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        contextLength: model.context_length ?? null,
        pricing: model.pricing || {},
        isFree: false
      }));

    return {
      success: true,
      models: normalizedModels,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    return reply.status(502).send({
      error: 'Failed to fetch AskCodi models',
      details: error.message
    });
  }
});

// Test API connection endpoint
fastify.post('/api/test', async (request, reply) => {
  const { apiKey, baseUrl, model } = request.body;
  const resolvedBaseUrl = (baseUrl || 'https://api.openai.com/v1').trim();
  const isLocalProvider = isLocalProviderBaseUrl(resolvedBaseUrl);
  const suppliedApiKey = typeof apiKey === 'string' ? apiKey : '';
  const originalConfig = getConfig();
  const originalKey = getApiKey();
  
  if (!isLocalProvider && !suppliedApiKey) {
    return reply.status(400).send({ error: 'API key is required' });
  }
  
  try {
    // Force reset the client to ensure new config is used
    const { resetClient } = await import('./src/agents/openaiService.js');
    resetClient();
    
    setApiKey(suppliedApiKey);
    updateConfig({ baseUrl: resolvedBaseUrl, model });
    
    console.log('Testing connection with:', {
      baseUrl: resolvedBaseUrl,
      model,
      apiKey: suppliedApiKey ? suppliedApiKey.substring(0, 10) + '...' : '(none - local provider)'
    });
    
    // Try to create a simple chat completion (cap at 20 tokens for speed)
    const { chat } = await import('./src/agents/openaiService.js');
    const result = await chat([
      { role: 'system', content: 'Reply with exactly: "Connection successful!"' },
      { role: 'user', content: 'Hello' }
    ], 20);
    
    console.log('Connection test result:', result);
    
    // Restore original config
    setApiKey(originalKey);
    updateConfig({ baseUrl: originalConfig.baseUrl, model: originalConfig.model });
    
    return { success: true, message: 'Connection successful!', response: result };
  } catch (error) {
    console.error('Connection test error:', error.message);
    console.error('Error stack:', error.stack);
    
    // Provide more detailed error information
    let detailedError = error.message;
    let errorType = 'unknown';
    
    // Try to identify the error type
    if (error.message.includes('ECONNREFUSED')) {
      errorType = 'connection_refused';
      detailedError = 'Connection refused. The server may be down or the URL is incorrect.';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      errorType = 'dns_resolution';
      detailedError = 'DNS resolution failed. Check if the URL is correct.';
    } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      errorType = 'timeout';
      detailedError = 'Connection timed out. Check your network connection.';
    } else if (error.message.includes('401') || error.message.includes('unauthorized')) {
      errorType = 'unauthorized';
      detailedError = 'Invalid API key or unauthorized access.';
    } else if (error.message.includes('403') || error.message.includes('forbidden')) {
      errorType = 'forbidden';
      detailedError = 'Access forbidden. Check API key permissions.';
    } else if (error.message.includes('429') || error.message.includes('rate limit')) {
      errorType = 'rate_limit';
      detailedError = 'Rate limit exceeded. Please try again later.';
    } else if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
      errorType = 'fetch_failed';
      detailedError = 'Network fetch failed. Check firewall/proxy settings or try again.';
    }
    
    // Restore original config on error too
    try {
      setApiKey(originalKey);
      updateConfig({ baseUrl: originalConfig.baseUrl, model: originalConfig.model });
    } catch (e) {
      // Ignore restore errors
    }
    
    return reply.status(400).send({ 
      success: false, 
      error: detailedError,
      errorType: errorType,
      originalError: error.message,
      details: error.stack
    });
  }
});

// ─── Search API routes ───

// Get search config (API keys masked)
fastify.get('/api/search/config', async (request, reply) => {
  const cfg = getSearchConfig();
  if (!cfg) return { provider: null, configured: false };
  return {
    provider: cfg.provider || null,
    configured: isSearchConfigured(),
    exa: cfg.exa ? {
      apiKey: cfg.exa.apiKey ? '***configured***' : null,
      baseUrl: cfg.exa.baseUrl || 'https://api.exa.ai'
    } : null
  };
});

// Save search config
fastify.post('/api/search/config', async (request, reply) => {
  const { provider, exa } = request.body;
  const update = { provider: provider || 'exa' };
  if (exa) {
    update.exa = {
      apiKey: (exa.apiKey || '').trim(),
      baseUrl: (exa.baseUrl || 'https://api.exa.ai').trim()
    };
  }
  updateSearchConfig(update);
  return { success: true };
});

// Test search — run a quick query to verify the key works
fastify.post('/api/search/test', async (request, reply) => {
  try {
    const result = await exaSearch('test query hello world', { numResults: 1, contents: false });
    return { success: true, resultCount: result.resultCount };
  } catch (error) {
    return reply.status(400).send({ success: false, error: error.message });
  }
});

// Execute a search (used by frontend for manual search testing)
fastify.post('/api/search', async (request, reply) => {
  const { query, numResults, type, category } = request.body;
  if (!query) return reply.status(400).send({ error: 'query is required' });
  try {
    const result = await exaSearch(query, { numResults, type, category });
    return result;
  } catch (error) {
    return reply.status(502).send({ error: error.message });
  }
});

// WebSocket endpoint for agent communication
fastify.get('/ws', { websocket: true }, (socket, req) => {
  clients.add(socket);
  
  // Send welcome message
  socket.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to agent server',
    apiConfigured: hasProviderAccess(),
    config: getConfig()
  }));
  
  socket.on('close', () => {
    clients.delete(socket);
    activeHandlers.delete(socket);
  });
  
  socket.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'task') {
        await handleTask(data.task, socket);
      } else if (data.type === 'stop') {
        const handler = activeHandlers.get(socket);
        if (handler) {
          handler.stop();
        }
      } else if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      socket.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });
});

// Handle agent task
async function handleTask(task, socket) {
  if (!hasProviderAccess()) {
    socket.send(JSON.stringify({
      type: 'error',
      message: 'Provider not configured. Set an API key for hosted providers, or use a local provider URL.'
    }));
    return;
  }
  
  // Create a new Master Handler for this task
  const masterHandler = createMasterHandler();
  activeHandlers.set(socket, masterHandler);
  
  // Send task received confirmation
  broadcast({
    type: 'status',
    agent: 'system',
    message: `Received task: "${task}"`
  });
  
  try {
    const result = await masterHandler.processTask(task, (message) => {
      // Don't broadcast further messages once the user has requested a stop.
      // Sub-agents running in parallel may still fire callbacks between the
      // stop signal and their next isStopped() check — silently drop those.
      if (masterHandler.stopped) return;
      broadcast(message);
    });
    
    // processTask already sends a 'complete' event with the synthesized result.
    // No additional broadcast needed here.
  } catch (error) {
    if (error.name === 'TaskStoppedError') {
      broadcast({ type: 'stopped', agent: 'system' });
    } else {
      socket.send(JSON.stringify({
        type: 'error',
        agent: 'system',
        message: error.message
      }));
    }
  } finally {
    activeHandlers.delete(socket);
  }
}

// Broadcast message to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  });
}

// Start the server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server running at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
