import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createMasterHandler } from './src/agents/index.js';
import { getApiKey, setApiKey, hasApiKey, getConfig, updateConfig } from './src/utils/config.js';

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

// Register plugins
await fastify.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/'
});

await fastify.register(fastifyWebsocket);

// Track connected clients
const clients = new Set();

// Health check endpoint
fastify.get('/api/health', async (request, reply) => {
  const config = getConfig();
  return { 
    status: 'ok', 
    apiConfigured: hasApiKey(),
    baseUrl: config.baseUrl,
    model: config.model
  };
});

// API configuration endpoint
fastify.post('/api/config', async (request, reply) => {
  const { apiKey, baseUrl, model } = request.body;
  
  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(400).send({ error: 'API key is required' });
  }
  
  updateConfig({
    apiKey,
    baseUrl,
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

// Test API connection endpoint
fastify.post('/api/test', async (request, reply) => {
  const { apiKey, baseUrl, model } = request.body;
  
  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(400).send({ error: 'API key is required' });
  }
  
  try {
    // Temporarily update config to test
    const originalKey = getApiKey();
    const originalUrl = getConfig().baseUrl;
    const originalModel = getConfig().model;
    
    // Force reset the client to ensure new config is used
    const { resetClient } = await import('./src/agents/openaiService.js');
    resetClient();
    
    setApiKey(apiKey);
    updateConfig({ baseUrl, model });
    
    console.log('Testing connection with:', { baseUrl, model, apiKey: apiKey.substring(0, 10) + '...' });
    
    // Try to create a simple chat completion
    const { chat } = await import('./src/agents/openaiService.js');
    const result = await chat([
      { role: 'system', content: 'Reply with exactly: "Connection successful!"' },
      { role: 'user', content: 'Hello' }
    ]);
    
    console.log('Connection test result:', result);
    
    // Restore original config
    setApiKey(originalKey);
    updateConfig({ baseUrl: originalUrl, model: originalModel });
    
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
      const originalKey = getApiKey();
      const originalUrl = getConfig().baseUrl;
      const originalModel = getConfig().model;
      setApiKey(originalKey);
      updateConfig({ baseUrl: originalUrl, model: originalModel });
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

// WebSocket endpoint for agent communication
fastify.get('/ws', { websocket: true }, (socket, req) => {
  clients.add(socket);
  
  // Send welcome message
  socket.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to agent server',
    apiConfigured: hasApiKey(),
    config: getConfig()
  }));
  
  socket.on('close', () => {
    clients.delete(socket);
  });
  
  socket.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'task') {
        await handleTask(data.task, socket);
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
  if (!hasApiKey()) {
    socket.send(JSON.stringify({
      type: 'error',
      message: 'API key not configured. Please set your OpenAI API key first.'
    }));
    return;
  }
  
  // Create a new Master Handler for this task
  const masterHandler = createMasterHandler();
  
  // Send task received confirmation
  broadcast({
    type: 'status',
    agent: 'system',
    message: `Received task: "${task}"`
  });
  
  try {
    const result = await masterHandler.processTask(task, (message) => {
      // Broadcast once to all clients (including the requester) to avoid duplicates
      broadcast(message);
    });
    
    // processTask already sends a 'complete' event with the synthesized result.
    // No additional broadcast needed here.
  } catch (error) {
    socket.send(JSON.stringify({
      type: 'error',
      agent: 'system',
      message: error.message
    }));
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
