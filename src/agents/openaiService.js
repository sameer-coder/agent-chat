import https from 'https';
import http from 'http';
import { getApiKey, getModel, getBaseUrl } from '../utils/config.js';

/**
 * Returns true when the URL targets a local machine (no API key needed, plain HTTP).
 */
function isLocalUrl(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch { return false; }
}

let lastApiKey = null;
let lastBaseUrl = null;

// ── Token usage tracking ──
let _onTokenUsage = null;

/**
 * Register a callback that fires whenever an API call returns token usage info.
 * Callback signature: ({ promptTokens, completionTokens, totalTokens, model }) => void
 * Pass null to unregister.
 */
export function setTokenUsageCallback(cb) {
  _onTokenUsage = typeof cb === 'function' ? cb : null;
}

function emitTokenUsage(usage, model) {
  if (!_onTokenUsage || !usage) return;
  _onTokenUsage({
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    model: model || getModel(),
  });
}

// ── Context snapshot tracking ──
let _onContextSnapshot = null;
let _currentCallAgentLabel = 'unknown';
let _snapshotCallId = 0;

/**
 * Register a callback that fires before every API call with a snapshot of
 * the messages array grouped by role.
 * Callback signature: (snapshot) => void  where snapshot is:
 *   { callId, agentLabel, timestamp, model, sections, totalEstimatedTokens }
 * Pass null to unregister.
 */
export function setContextSnapshotCallback(cb) {
  _onContextSnapshot = typeof cb === 'function' ? cb : null;
}

/**
 * Set the agent label used to tag the next (and future) context snapshots.
 * Call this immediately before invoking chat() or chatStream().
 */
export function setCallAgentLabel(label) {
  _currentCallAgentLabel = label || 'unknown';
}

function buildSections(messages) {
  // Group consecutive messages by role; search-result injections are tagged separately
  const sectionMap = {};
  for (const msg of messages) {
    let role = msg.role; // 'system' | 'user' | 'assistant'
    // Heuristic: user messages that begin with search result injection text are
    // categorised as 'tool_result' for display purposes.
    if (role === 'user' && typeof msg.content === 'string' &&
        (msg.content.startsWith('Here are the web search results') ||
         msg.content.startsWith('Search results for'))) {
      role = 'tool_result';
    }
    if (!sectionMap[role]) {
      sectionMap[role] = { role, messageCount: 0, charCount: 0, estimatedTokens: 0 };
    }
    const chars = typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;
    sectionMap[role].messageCount += 1;
    sectionMap[role].charCount += chars;
    sectionMap[role].estimatedTokens += Math.ceil(chars / 4);
  }
  // Return in a stable display order
  const ORDER = ['system', 'user', 'assistant', 'tool_result'];
  return ORDER.filter(r => sectionMap[r]).map(r => sectionMap[r]);
}

/**
 * Build an array of individual messages with role+content for the full content
 * viewer.  Each entry carries the effective role (with the tool_result heuristic)
 * and estimated tokens so the UI can render per-message detail.
 */
function buildMessages(messages) {
  return messages.map((msg, i) => {
    let role = msg.role;
    if (role === 'user' && typeof msg.content === 'string' &&
        (msg.content.startsWith('Here are the web search results') ||
         msg.content.startsWith('Search results for'))) {
      role = 'tool_result';
    }
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
    return {
      index: i,
      role,
      content,
      charCount: content.length,
      estimatedTokens: Math.ceil(content.length / 4),
    };
  });
}

function emitContextSnapshot(messages) {
  if (!_onContextSnapshot) return;
  const sections = buildSections(messages);
  const totalEstimatedTokens = sections.reduce((s, sec) => s + sec.estimatedTokens, 0);
  _onContextSnapshot({
    callId: ++_snapshotCallId,
    agentLabel: _currentCallAgentLabel,
    timestamp: Date.now(),
    model: getModel(),
    sections,
    totalEstimatedTokens,
    messages: buildMessages(messages),
  });
}

/**
 * Force reset
 */
export function resetClient() {
  lastApiKey = null;
  lastBaseUrl = null;
  console.log('Client reset');
}

/**
 * Direct fetch call using native https module to bypass SSL issues
 */
async function directHttpsRequest(messages, isStream = false, maxTokens = 2000) {
  emitContextSnapshot(messages);
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const model = getModel();
  const local = isLocalUrl(baseUrl);

  if (!apiKey && !local) {
    throw new Error('OpenAI API key not configured');
  }
  
  // Extract hostname from baseUrl
  const url = new URL(baseUrl);
  const hostname = url.hostname;
  const isHttp = url.protocol === 'http:';
  const defaultPort = isHttp ? 80 : 443;
  const port = url.port ? parseInt(url.port, 10) : defaultPort;
  const path = url.pathname + '/chat/completions';
  const transport = isHttp ? http : https;
  
  const isOpenRouter = hostname.includes('openrouter.ai');
  const isAskCodi = hostname.includes('askcodi.com');
  
  const postData = JSON.stringify({
    model,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
    ...(isStream ? { stream: true } : {})
  });
  
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
  };
  
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'Multi-Agent Dashboard';
  }
  
  if (isAskCodi) {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'Multi-Agent Dashboard';
  }
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port,
      path,
      method: 'POST',
      headers,
      // Bypass SSL verification for corporate proxy/VPN scenarios
      ...(isHttp ? {} : { rejectUnauthorized: false })
    };
    
    const req = transport.request(options, (res) => {
      if (isStream) {
        resolve({ status: res.statusCode, body: res });
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            emitTokenUsage(parsed.usage, parsed.model);
            resolve(parsed.choices[0]?.message?.content || '');
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        } else {
          reject(new Error(`API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    // Timeout after 20 seconds to prevent hanging requests
    req.setTimeout(20000, () => {
      req.destroy(new Error('Request timed out after 20 seconds. Check the API URL and provider status.'));
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Send a chat message and get a streaming response
 */
export async function* chatStream(messages) {
  emitContextSnapshot(messages);
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const model = getModel();
  const local = isLocalUrl(baseUrl);

  if (!apiKey && !local) {
    throw new Error('OpenAI API key not configured');
  }
  
  const url = new URL(baseUrl);
  const hostname = url.hostname;
  const isHttp = url.protocol === 'http:';
  const defaultPort = isHttp ? 80 : 443;
  const port = url.port ? parseInt(url.port, 10) : defaultPort;
  const path = url.pathname + '/chat/completions';
  const transport = isHttp ? http : https;
  
  const isOpenRouter = hostname.includes('openrouter.ai');
  const isAskCodi = hostname.includes('askcodi.com');
  
  const postData = JSON.stringify({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 2000,
    stream: true
  });
  
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
  };
  
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'Multi-Agent Dashboard';
  }
  
  if (isAskCodi) {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'Multi-Agent Dashboard';
  }

  // We need to bridge the callback-based https stream into an async generator.
  // Use a queue + resolve/reject pattern so we can yield from the generator.
  const queue = [];       // buffered chunks waiting to be yielded
  let done = false;       // true once the stream ends
  let error = null;       // set if the stream errors
  let waiting = null;     // { resolve } when the generator is waiting for data

  function enqueue(value) {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w.resolve(value);
    } else {
      queue.push(value);
    }
  }

  function finish(err) {
    done = true;
    error = err || null;
    if (waiting) {
      const w = waiting;
      waiting = null;
      if (err) {
        w.reject(err);
      } else {
        w.resolve(undefined); // signal end
      }
    }
  }

  // Start the HTTP request (non-blocking)
  const options = {
    hostname,
    port,
    path,
    method: 'POST',
    headers,
    ...(isHttp ? {} : { rejectUnauthorized: false })
  };

  const req = transport.request(options, (res) => {
    console.log(`[chatStream] Response status: ${res.statusCode}, content-type: ${res.headers['content-type']}`);
    
    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        finish(new Error(`API error: ${res.statusCode} - ${data}`));
      });
      return;
    }

    // Check if the API actually returned a streaming response
    const contentType = res.headers['content-type'] || '';
    const isSSE = contentType.includes('text/event-stream') || contentType.includes('text/plain');
    
    // If the API ignored stream:true and returned JSON, parse it as a regular response
    if (contentType.includes('application/json')) {
      console.log('[chatStream] API returned JSON instead of SSE stream — parsing as non-streaming');
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          emitTokenUsage(parsed.usage, parsed.model);
          const content = parsed.choices?.[0]?.message?.content || '';
          if (content) {
            enqueue(content);
          }
          finish();
        } catch (e) {
          finish(new Error(`Failed to parse JSON response: ${data.substring(0, 200)}`));
        }
      });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    res.on('data', (chunk) => {
      const rawData = decoder.decode(chunk, { stream: true });
      buffer += rawData;
      if (chunkCount === 0) {
        console.log(`[chatStream] First raw data chunk (${rawData.length} bytes): ${rawData.substring(0, 200)}`);
      }
      chunkCount++;

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            console.log(`[chatStream] Received [DONE] after ${chunkCount} raw chunks`);
            finish();
            return;
          }
          try {
            const parsed = JSON.parse(payload);
            // Capture usage from final SSE chunk (OpenAI includes it)
            if (parsed.usage) {
              emitTokenUsage(parsed.usage, parsed.model);
            }
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              enqueue(content);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    });

    res.on('end', () => {
      console.log(`[chatStream] Stream ended after ${chunkCount} raw chunks`);
      finish();
    });
  });

  req.on('error', (e) => {
    finish(e);
  });

  req.write(postData);
  req.end();

  // Yield chunks as they arrive
  while (true) {
    if (error) throw error;
    if (queue.length > 0) {
      yield queue.shift();
      continue;
    }
    if (done) return;
    // Wait for the next chunk or stream end
    const value = await new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
    if (value === undefined) return; // stream ended
    yield value;
  }
}

/**
 * Send a chat message and get a complete response
 */
export async function chat(messages, maxTokens = 2000) {
  return await directHttpsRequest(messages, false, maxTokens);
}

/**
 * Check if OpenAI is properly configured
 * @returns {boolean} Whether the service is ready
 */
export function isConfigured() {
  try {
    return getApiKey() !== null;
  } catch {
    return false;
  }
}

export default {
  chat,
  chatStream,
  isConfigured
};
