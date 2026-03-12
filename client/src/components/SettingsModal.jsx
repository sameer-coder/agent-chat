import { useState, useEffect, useCallback } from 'react';
import { useOrchestrationDispatch } from '../context/OrchestrationContext.jsx';
import { ActionTypes } from '../context/orchestrationReducer.js';
import { isLocalProvider } from '../utils.js';

const PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
  { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: '' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct' },
  { label: 'Strongwall', baseUrl: 'https://api.strongwall.ai/v1', model: 'strongwall-v1' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama3-8b-8192' },
  { label: 'AskCodi', baseUrl: 'https://api.askcodi.com/v1', model: '' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
];

const SECTIONS = { api: 'api', prompt: 'prompt' };
const MAX_RECENT_MODELS = 3;

function isOpenRouterBaseUrl(value) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.includes('openrouter.ai');
  } catch {
    return value.toLowerCase().includes('openrouter.ai');
  }
}

function pushRecentModelLocal(list, modelName) {
  if (!modelName) return Array.isArray(list) ? list : [];
  const next = Array.isArray(list) ? [...list] : [];
  const idx = next.indexOf(modelName);
  if (idx !== -1) next.splice(idx, 1);
  next.unshift(modelName);
  return next.slice(0, MAX_RECENT_MODELS);
}

export default function SettingsModal({ isOpen, onClose }) {
  const dispatch = useOrchestrationDispatch();
  const [activeSection, setActiveSection] = useState(SECTIONS.api);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetValue, setPresetValue] = useState('');
  const [recentModels, setRecentModels] = useState([]);
  const [openRouterFreeModels, setOpenRouterFreeModels] = useState([]);
  const [selectedFreeModel, setSelectedFreeModel] = useState('');
  const [loadingFreeModels, setLoadingFreeModels] = useState(false);
  const [freeModelsError, setFreeModelsError] = useState('');

  const isOpenRouter = isOpenRouterBaseUrl(baseUrl);

  // Load saved config when opening
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const [providerResp, promptResp] = await Promise.all([
          fetch('/api/provider-config'),
          fetch('/api/system-prompt'),
        ]);

        // Load system prompt
        if (promptResp.ok) {
          const promptData = await promptResp.json();
          setSystemPrompt(promptData.systemPrompt || '');
        }

        if (!providerResp.ok) return;
        const data = await providerResp.json();
        const active = (data.providers || []).find(p => p.name === data.activeProvider);
        const savedBaseUrl = active?.baseUrl || 'https://api.openai.com/v1';
        setBaseUrl(savedBaseUrl);

        // Load API key and model for this provider
        const keyResp = await fetch(`/api/provider-config/key?baseUrl=${encodeURIComponent(savedBaseUrl)}`);
        if (keyResp.ok) {
          const keyData = await keyResp.json();
          setApiKey(keyData.apiKey || '');
          setModel(keyData.model || active?.model || 'gpt-4o-mini');
          setRecentModels(Array.isArray(keyData.recentModels) ? keyData.recentModels : []);
        } else {
          setRecentModels([]);
        }

        // Sync preset
        const match = PRESETS.find(p => p.baseUrl === savedBaseUrl);
        setPresetValue(match ? match.baseUrl : '');
      } catch { /* ignore */ }
    })();
  }, [isOpen]);

  const handlePresetChange = useCallback(async (value) => {
    setPresetValue(value);
    const preset = PRESETS.find(p => p.baseUrl === value);
    if (!preset) return;
    setBaseUrl(preset.baseUrl);
    
    // Load saved data for this provider
    try {
      const resp = await fetch(`/api/provider-config/key?baseUrl=${encodeURIComponent(preset.baseUrl)}`);
      if (resp.ok) {
        const data = await resp.json();
        setApiKey(data.apiKey || '');
        setModel(data.model || preset.model || '');
        setRecentModels(Array.isArray(data.recentModels) ? data.recentModels : []);
      } else {
        setModel(preset.model || '');
        setApiKey('');
        setRecentModels([]);
      }
    } catch {
      setModel(preset.model || '');
      setApiKey('');
      setRecentModels([]);
    }
  }, []);

  // Load only free OpenRouter models when OpenRouter is selected.
  useEffect(() => {
    if (!isOpen || !isOpenRouter) {
      setOpenRouterFreeModels([]);
      setSelectedFreeModel('');
      setLoadingFreeModels(false);
      setFreeModelsError('');
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingFreeModels(true);
      setFreeModelsError('');
      try {
        const resp = await fetch('/api/openrouter/models');
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data?.error || 'Failed to load OpenRouter models');
        }

        const freeIds = (Array.isArray(data.models) ? data.models : [])
          .filter((m) => typeof m?.id === 'string' && (m.isFree || m.id.toLowerCase().endsWith(':free')))
          .map((m) => m.id.trim())
          .filter((id) => id.toLowerCase().endsWith(':free'));

        const uniqueSorted = [...new Set(freeIds)].sort((a, b) => a.localeCompare(b));
        if (cancelled) return;
        setOpenRouterFreeModels(uniqueSorted);
      } catch (err) {
        if (cancelled) return;
        setOpenRouterFreeModels([]);
        setFreeModelsError(err?.message || 'Failed to load OpenRouter free models');
      } finally {
        if (!cancelled) setLoadingFreeModels(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, isOpenRouter]);

  // Keep free-model dropdown in sync with the model text input.
  useEffect(() => {
    if (!isOpenRouter || !model) {
      setSelectedFreeModel('');
      return;
    }
    setSelectedFreeModel(openRouterFreeModels.includes(model) ? model : '');
  }, [isOpenRouter, model, openRouterFreeModels]);

  const handleSelectFreeModel = useCallback((value) => {
    setSelectedFreeModel(value);
    if (!value) return;
    setModel(value);
    setRecentModels((prev) => pushRecentModelLocal(prev, value));
  }, []);

  const handleSave = async () => {
    const resolvedUrl = baseUrl.trim() || 'https://api.openai.com/v1';
    const resolvedModel = model.trim() || 'gpt-4o-mini';
    const isLocal = isLocalProvider(resolvedUrl);

    if (!apiKey.trim() && !isLocal) {
      alert('Please enter an API key');
      return;
    }

    setSaving(true);
    try {
      // Save API config
      const resp = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), baseUrl: resolvedUrl, model: resolvedModel }),
      });
      if (resp.ok) {
        const data = await resp.json();
        dispatch({
          type: ActionTypes.SET_API_STATUS,
          configured: true,
          config: { baseUrl: data.baseUrl, model: data.model },
        });

        // Also save to provider config
        await fetch('/api/provider-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim(), baseUrl: resolvedUrl, model: resolvedModel }),
        });

        // Save system prompt
        await fetch('/api/system-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemPrompt }),
        });

        onClose();
      } else {
        const data = await resp.json();
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const resolvedUrl = baseUrl.trim() || 'https://api.openai.com/v1';
    const resolvedModel = model.trim() || 'gpt-4o-mini';
    const isLocal = isLocalProvider(resolvedUrl);

    if (!apiKey.trim() && !isLocal) {
      alert('Please enter an API key first');
      return;
    }

    setTesting(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), baseUrl: resolvedUrl, model: resolvedModel }),
        signal: controller.signal,
      });
      const data = await resp.json();
      if (data.success) {
        alert(`✅ Connection successful!\n\nModel: ${resolvedModel}\nResponse: ${data.response?.substring(0, 100) || '(empty)'}`);
      } else {
        alert(`❌ Connection failed!\n\nError: ${data.error}`);
      }
    } catch (err) {
      const message = err.name === 'AbortError'
        ? 'Request timed out after 25 seconds. Check the API URL and provider status.'
        : err.message;
      alert(`❌ Connection failed!\n\nError: ${message}`);
    } finally {
      clearTimeout(timeoutId);
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Section Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveSection(SECTIONS.api)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeSection === SECTIONS.api
                ? 'text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/40'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            API Configuration
          </button>
          <button
            onClick={() => setActiveSection(SECTIONS.prompt)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeSection === SECTIONS.prompt
                ? 'text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/40'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            System Prompt
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* ── API Configuration Section ── */}
          {activeSection === SECTIONS.api && (
            <>
              {/* Preset */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Provider Preset</label>
                <select
                  value={presetValue}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                >
                  <option value="">Select a provider...</option>
                  {PRESETS.map((p) => (
                    <option key={p.baseUrl} value={p.baseUrl}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">API Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={isLocalProvider(baseUrl) ? 'Optional for local providers' : 'sk-...'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
                <input
                  type="text"
                  list="recent-models-list"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                />
                <datalist id="recent-models-list">
                  {recentModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {recentModels.length > 0 && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Recent: {recentModels.join(', ')}
                  </p>
                )}
              </div>

              {/* OpenRouter free models */}
              {isOpenRouter && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">OpenRouter Free Models</label>
                  <select
                    value={selectedFreeModel}
                    onChange={(e) => handleSelectFreeModel(e.target.value)}
                    disabled={loadingFreeModels || openRouterFreeModels.length === 0}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value="">
                      {loadingFreeModels
                        ? 'Loading free models...'
                        : openRouterFreeModels.length > 0
                          ? 'Select a free OpenRouter model...'
                          : 'No free models available'}
                    </option>
                    {openRouterFreeModels.map((modelId) => (
                      <option key={modelId} value={modelId}>{modelId}</option>
                    ))}
                  </select>
                  {freeModelsError && (
                    <p className="mt-1 text-[11px] text-amber-600">{freeModelsError}</p>
                  )}
                  <p className="mt-1 text-[11px] text-gray-500">
                    Selecting a free model updates the model field using the exact OpenRouter id (for example, stepfun/step-3.5-flash:free).
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── System Prompt Section ── */}
          {activeSection === SECTIONS.prompt && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Master Agent System Prompt
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Define custom instructions for the Master Handler agent. This will be prepended to the built-in orchestration prompt.
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="e.g. You are an expert software architect. Always provide code examples in TypeScript. Focus on scalability and best practices..."
                  rows={8}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 resize-y min-h-[120px]"
                />
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-gray-400">
                    {systemPrompt.length > 0 ? `${systemPrompt.length} characters` : 'No custom prompt set'}
                  </span>
                  {systemPrompt.length > 0 && (
                    <button
                      onClick={() => setSystemPrompt('')}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 bg-gray-50">
          {activeSection === SECTIONS.api ? (
            <button
              onClick={handleTest}
              disabled={testing}
              className="text-sm text-gray-600 hover:text-gray-800 font-medium disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
