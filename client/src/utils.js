import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdown(text) {
  if (!text) return '';
  try {
    const raw = marked.parse(text);
    return DOMPurify.sanitize(raw);
  } catch {
    return escapeHtml(text);
  }
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function extractProviderName(baseUrl) {
  if (!baseUrl) return '';
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname.includes('openai.com')) return 'OpenAI';
    if (hostname.includes('openrouter.ai')) return 'OpenRouter';
    if (hostname.includes('deepseek.com')) return 'DeepSeek';
    if (hostname.includes('nvidia.com')) return 'NVIDIA';
    if (hostname.includes('strongwall.ai')) return 'Strongwall';
    if (hostname.includes('groq.com')) return 'Groq';
    if (hostname.includes('askcodi.com')) return 'AskCodi';
    if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
      if (baseUrl.includes('11434')) return 'Ollama';
      if (baseUrl.includes('1234')) return 'LM Studio';
      return 'Local';
    }
    const parts = hostname.replace('www.', '').split('.');
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch { return ''; }
}

export function isLocalProvider(baseUrl) {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch { return false; }
}
