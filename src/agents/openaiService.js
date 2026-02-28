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
async function directHttpsRequest(messages, isStream = false) {
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
    max_tokens: 2000,
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
            resolve(parsed.choices[0]?.message?.content || '');
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        } else {
          reject(new Error(`API error: ${res.statusCode} - ${data}`));
        }
      });
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
export async function chat(messages) {
  return await directHttpsRequest(messages, false);
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
