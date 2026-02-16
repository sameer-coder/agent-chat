import https from 'https';
import { getApiKey, getModel, getBaseUrl } from '../utils/config.js';

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
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  // Extract hostname from baseUrl
  const url = new URL(baseUrl);
  const hostname = url.hostname;
  const path = url.pathname + '/chat/completions';
  
  const isOpenRouter = hostname.includes('openrouter.ai');
  
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
    'Authorization': `Bearer ${apiKey}`
  };
  
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'Multi-Agent Dashboard';
  }
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method: 'POST',
      headers,
      // Bypass SSL verification for corporate proxy/VPN scenarios
      rejectUnauthorized: false
    };
    
    const req = https.request(options, (res) => {
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
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  const url = new URL(baseUrl);
  const hostname = url.hostname;
  const path = url.pathname + '/chat/completions';
  
  const isOpenRouter = hostname.includes('openrouter.ai');
  
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
    'Authorization': `Bearer ${apiKey}`
  };
  
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'Multi-Agent Dashboard';
  }
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method: 'POST',
      headers,
      rejectUnauthorized: false
    };
    
    const req = https.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          reject(new Error(`API error: ${res.statusCode} - ${data}`));
        });
        return;
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      
      res.on('data', (chunk) => {
        buffer += decoder.decode(chunk, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              resolve(fullContent);
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      });
      
      res.on('end', () => {
        resolve(fullContent);
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
