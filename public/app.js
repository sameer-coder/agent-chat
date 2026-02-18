// Multi-Agent Dashboard Frontend

class AgentDashboard {
  constructor() {
    this.ws = null;
    this.messagesContainer = document.getElementById('messages');
    this.taskInput = document.getElementById('task-input');
    this.submitBtn = document.getElementById('submit-btn');
    this.settingsBtn = document.getElementById('settings-btn');
    this.settingsModal = document.getElementById('settings-modal');
    this.apiKeyInput = document.getElementById('api-key-input');
    this.apiUrlInput = document.getElementById('api-url-input');
    this.modelInput = document.getElementById('model-input');
    this.saveApiKeyBtn = document.getElementById('save-api-key');
    this.testConnectionBtn = document.getElementById('test-connection');
    this.closeModalBtn = document.getElementById('close-modal');
    this.cancelModalBtn = document.getElementById('cancel-modal');
    this.connectionStatus = document.getElementById('connection-status');
    this.apiStatus = document.getElementById('api-status');
    this.presetSelect = document.getElementById('preset-select');
    this.freeModelsSection = document.getElementById('free-models-section');
    this.freeModelSelect = document.getElementById('free-model-select');
    this.freeOnlyCheckbox = document.getElementById('free-only-checkbox');
    
    // AskCodi model section
    this.askcodiModelsSection = document.getElementById('askcodi-models-section');
    this.askcodiModelSelect = document.getElementById('askcodi-model-select');
    
    // Recent models section
    this.recentModelsSection = document.getElementById('recent-models-section');
    this.recentModelSelect = document.getElementById('recent-model-select');
    
    // Agent result modal
    this.agentResultModal = document.getElementById('agent-result-modal');
    this.agentResultModalTitle = document.getElementById('agent-result-modal-title');
    this.agentResultModalBody = document.getElementById('agent-result-modal-body');
    this.closeAgentResultModalBtn = document.getElementById('close-agent-result-modal');
    
    // Dynamic agent cards container
    this.dynamicAgentCards = document.getElementById('dynamic-agent-cards');
    
    // Store latest agent results for modal viewing (keyed by agent index)
    this.agentResults = {};
    
    // Dynamic agent names (updated from server each task) — keyed by index
    this.agentNames = {};
    this.agentCount = 0;
    
    // Streaming state: accumulates raw text for each agent during streaming
    this.streamingBuffers = {};
    
    this.isConnected = false;
    this.isProcessing = false;
    this.apiConfigured = false;
    this.openRouterModels = [];
    this.isLoadingOpenRouterModels = false;
    this.openRouterModelError = '';
    this.askcodiModels = [];
    this.isLoadingAskcodiModels = false;
    this.askcodiModelError = '';
    this.currentConfig = {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    };
    
    // Color palette for up to 5 agents
    this.agentColorPalette = [
      { dot: 'bg-cyan-500',    border: 'border-cyan-300',    bg: 'bg-cyan-50',    text: 'text-cyan-700',    headerBg: 'bg-cyan-100',    badge: 'bg-cyan-500',    subtaskBg: 'bg-cyan-50',  subtaskBorder: 'border-cyan-200', subtaskText: 'text-cyan-600' },
      { dot: 'bg-emerald-500', border: 'border-emerald-300', bg: 'bg-emerald-50', text: 'text-emerald-700', headerBg: 'bg-emerald-100', badge: 'bg-emerald-500', subtaskBg: 'bg-emerald-50', subtaskBorder: 'border-emerald-200', subtaskText: 'text-emerald-600' },
      { dot: 'bg-amber-500',   border: 'border-amber-300',   bg: 'bg-amber-50',   text: 'text-amber-700',   headerBg: 'bg-amber-100',   badge: 'bg-amber-500',   subtaskBg: 'bg-amber-50',  subtaskBorder: 'border-amber-200', subtaskText: 'text-amber-600' },
      { dot: 'bg-rose-500',    border: 'border-rose-300',    bg: 'bg-rose-50',    text: 'text-rose-700',    headerBg: 'bg-rose-100',    badge: 'bg-rose-500',    subtaskBg: 'bg-rose-50',   subtaskBorder: 'border-rose-200', subtaskText: 'text-rose-600' },
      { dot: 'bg-indigo-500',  border: 'border-indigo-300',  bg: 'bg-indigo-50',  text: 'text-indigo-700',  headerBg: 'bg-indigo-100',  badge: 'bg-indigo-500',  subtaskBg: 'bg-indigo-50', subtaskBorder: 'border-indigo-200', subtaskText: 'text-indigo-600' }
    ];
    
    this.init();
  }

  init() {
    this.connectWebSocket();
    this.bindEvents();
    this.loadSavedConfig().then(() => {
      this.refreshOpenRouterModelSection(this.apiUrlInput.value.trim(), false);
    });
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    this.ws.onopen = () => {
      this.isConnected = true;
      this.updateConnectionStatus(true);
    };
    
    this.ws.onclose = () => {
      this.isConnected = false;
      this.updateConnectionStatus(false);
      setTimeout(() => this.connectWebSocket(), 3000);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };
  }

  bindEvents() {
    this.submitBtn.addEventListener('click', () => this.submitTask());
    this.taskInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitTask();
      }
    });
    
    this.settingsBtn.addEventListener('click', () => this.showModal());
    this.closeModalBtn.addEventListener('click', () => this.hideModal());
    this.cancelModalBtn.addEventListener('click', () => this.hideModal());
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.hideModal();
    });
    
    this.saveApiKeyBtn.addEventListener('click', () => this.saveApiConfig());
    this.apiKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.saveApiConfig();
    });
    
    this.testConnectionBtn.addEventListener('click', () => this.testConnection());
    
    if (this.presetSelect) {
      this.presetSelect.addEventListener('change', () => this.handlePresetChange());
    }
    
    if (this.freeModelSelect) {
      this.freeModelSelect.addEventListener('change', () => {
        if (this.freeModelSelect.value) {
          this.modelInput.value = this.freeModelSelect.value;
        }
      });
    }

    if (this.freeOnlyCheckbox) {
      this.freeOnlyCheckbox.addEventListener('change', () => {
        this.renderOpenRouterModelOptions();
      });
    }

    if (this.askcodiModelSelect) {
      this.askcodiModelSelect.addEventListener('change', () => {
        if (this.askcodiModelSelect.value) {
          this.modelInput.value = this.askcodiModelSelect.value;
        }
      });
    }

    // Recent models dropdown
    if (this.recentModelSelect) {
      this.recentModelSelect.addEventListener('change', () => {
        if (this.recentModelSelect.value) {
          this.modelInput.value = this.recentModelSelect.value;
        }
      });
    }

    // Agent result modal close
    if (this.closeAgentResultModalBtn) {
      this.closeAgentResultModalBtn.addEventListener('click', () => this.hideAgentResultModal());
    }
    if (this.agentResultModal) {
      this.agentResultModal.addEventListener('click', (e) => {
        if (e.target === this.agentResultModal) this.hideAgentResultModal();
      });
    }
    
    this.apiUrlInput.addEventListener('change', async () => {
      const baseUrl = this.apiUrlInput.value.trim();
      if (baseUrl) {
        const savedModel = await this.fetchModelForProvider(baseUrl);
        if (savedModel) {
          this.modelInput.value = savedModel;
        }
        this.syncPresetToBaseUrl(baseUrl);
        this.refreshOpenRouterModelSection(baseUrl, true);
        this.refreshRecentModels(baseUrl);
        
        const savedApiKey = await this.fetchApiKeyForProvider(baseUrl);
        if (savedApiKey) {
          this.apiKeyInput.value = savedApiKey;
        } else {
          this.apiKeyInput.value = '';
        }
      }
    });
  }

  // ── Agent color helpers ──
  getAgentColors(agentIndex) {
    const idx = typeof agentIndex === 'number' ? agentIndex : 0;
    return this.agentColorPalette[idx % this.agentColorPalette.length];
  }

  /**
   * Normalize agent identifier from message data to an integer index.
   * Handles: numeric index, "alpha", "beta", "sub-agent-N", or legacy string keys.
   */
  normalizeAgentIndex(agent) {
    if (typeof agent === 'number') return agent;
    const s = String(agent).toLowerCase();
    if (s === 'alpha' || s === 'sub-agent-alpha') return 0;
    if (s === 'beta' || s === 'sub-agent-beta') return 1;
    const m = s.match(/sub-agent-(\d+)/);
    if (m) return parseInt(m[1], 10);
    const n = parseInt(s, 10);
    if (!isNaN(n)) return n;
    return -1; // unknown
  }

  // ── Dynamic sidebar cards ──
  createAgentCards(count) {
    if (!this.dynamicAgentCards) return;
    this.dynamicAgentCards.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const colors = this.getAgentColors(i);
      const name = this.agentNames[i] || `Agent ${i}`;
      const card = document.createElement('div');
      card.id = `agent-card-${i}`;
      card.className = 'bg-gray-50 rounded-lg p-3 border border-gray-200 transition-colors';
      card.innerHTML = `
        <div class="flex items-center gap-2 mb-2">
          <div class="w-3 h-3 rounded-full ${colors.dot}"></div>
          <span id="agent-name-${i}" class="font-medium text-sm">${this.escapeHtml(name)}</span>
        </div>
        <div id="agent-status-${i}" class="text-xs text-gray-500">Idle</div>
      `;
      card.addEventListener('click', () => this.showAgentResultModal(i));
      this.dynamicAgentCards.appendChild(card);
    }
  }

  parsePresetValue(value) {
    const separatorIndex = value.indexOf('|');
    if (separatorIndex === -1) {
      return [value, ''];
    }
    return [value.slice(0, separatorIndex), value.slice(separatorIndex + 1)];
  }

  syncPresetToBaseUrl(baseUrl) {
    if (!this.presetSelect || !baseUrl) return;
    const matchingOption = Array.from(this.presetSelect.options).find((option) => {
      if (!option.value) return false;
      const [presetBaseUrl] = this.parsePresetValue(option.value);
      return presetBaseUrl === baseUrl;
    });
    this.presetSelect.value = matchingOption ? matchingOption.value : '';
  }

  async handlePresetChange() {
    const value = this.presetSelect?.value || '';
    if (!value) return;
    const [baseUrl, model] = this.parsePresetValue(value);
    this.apiUrlInput.value = baseUrl;
    const savedModel = await this.fetchModelForProvider(baseUrl);
    this.modelInput.value = savedModel || model || this.modelInput.value || 'gpt-4o-mini';
    this.refreshOpenRouterModelSection(baseUrl, true);
    this.refreshRecentModels(baseUrl);
    const savedApiKey = await this.fetchApiKeyForProvider(baseUrl);
    if (savedApiKey) {
      this.apiKeyInput.value = savedApiKey;
    } else {
      this.apiKeyInput.value = '';
    }
  }

  isOpenRouterProvider(baseUrl) {
    return baseUrl.includes('openrouter.ai');
  }

  isAskCodiProvider(baseUrl) {
    return baseUrl.includes('askcodi.com');
  }

  async refreshOpenRouterModelSection(baseUrl, forceRefresh = true) {
    // Handle OpenRouter section
    if (this.freeModelsSection) {
      if (this.isOpenRouterProvider(baseUrl)) {
        this.freeModelsSection.classList.remove('hidden');
        await this.loadOpenRouterModels(forceRefresh);
      } else {
        this.freeModelsSection.classList.add('hidden');
      }
    }
    // Handle AskCodi section
    if (this.askcodiModelsSection) {
      if (this.isAskCodiProvider(baseUrl)) {
        this.askcodiModelsSection.classList.remove('hidden');
        await this.loadAskcodiModels(forceRefresh);
      } else {
        this.askcodiModelsSection.classList.add('hidden');
      }
    }
  }

  async loadOpenRouterModels(forceRefresh = false) {
    if (this.isLoadingOpenRouterModels) return;
    if (!forceRefresh && this.openRouterModels.length > 0) {
      this.renderOpenRouterModelOptions();
      return;
    }
    this.isLoadingOpenRouterModels = true;
    this.openRouterModelError = '';
    this.renderOpenRouterModelOptions();
    try {
      const headers = {};
      const apiKey = this.apiKeyInput.value.trim();
      if (apiKey) headers['X-OpenRouter-Api-Key'] = apiKey;
      const response = await fetch('/api/openrouter/models', { headers });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to fetch OpenRouter models');
      this.openRouterModels = Array.isArray(data.models) ? data.models : [];
      this.openRouterModelError = '';
    } catch (error) {
      this.openRouterModels = [];
      this.openRouterModelError = error.message;
    } finally {
      this.isLoadingOpenRouterModels = false;
      this.renderOpenRouterModelOptions();
    }
  }

  getFilteredOpenRouterModels() {
    const freeOnly = this.freeOnlyCheckbox?.checked ?? true;
    if (!freeOnly) return this.openRouterModels;
    return this.openRouterModels.filter((model) => model.isFree);
  }

  renderOpenRouterModelOptions() {
    if (!this.freeModelSelect) return;
    const previousSelection = this.modelInput.value.trim() || this.freeModelSelect.value;
    const models = this.getFilteredOpenRouterModels();
    this.freeModelSelect.innerHTML = '';
    if (this.isLoadingOpenRouterModels) {
      this.freeModelSelect.appendChild(new Option('Loading OpenRouter models...', ''));
      return;
    }
    if (this.openRouterModelError) {
      this.freeModelSelect.appendChild(new Option('Failed to load models', ''));
      return;
    }
    if (models.length === 0) {
      const emptyMessage = (this.freeOnlyCheckbox?.checked ?? true) ? 'No free models available' : 'No models available';
      this.freeModelSelect.appendChild(new Option(emptyMessage, ''));
      return;
    }
    models.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((model) => {
      const priceTag = model.isFree ? ' (Free)' : '';
      this.freeModelSelect.appendChild(new Option(`${model.name}${priceTag}`, model.id));
    });
    const selectedModel = models.find((model) => model.id === previousSelection)?.id || models[0].id;
    this.freeModelSelect.value = selectedModel;
    this.modelInput.value = selectedModel;
  }

  async loadAskcodiModels(forceRefresh = false) {
    if (this.isLoadingAskcodiModels) return;
    if (!forceRefresh && this.askcodiModels.length > 0) {
      this.renderAskcodiModelOptions();
      return;
    }
    this.isLoadingAskcodiModels = true;
    this.askcodiModelError = '';
    this.renderAskcodiModelOptions();
    try {
      const headers = {};
      const apiKey = this.apiKeyInput.value.trim();
      if (apiKey) headers['X-AskCodi-Api-Key'] = apiKey;
      const response = await fetch('/api/askcodi/models', { headers });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to fetch AskCodi models');
      this.askcodiModels = Array.isArray(data.models) ? data.models : [];
      this.askcodiModelError = '';
    } catch (error) {
      this.askcodiModels = [];
      this.askcodiModelError = error.message;
    } finally {
      this.isLoadingAskcodiModels = false;
      this.renderAskcodiModelOptions();
    }
  }

  renderAskcodiModelOptions() {
    if (!this.askcodiModelSelect) return;
    const previousSelection = this.modelInput.value.trim() || this.askcodiModelSelect.value;
    this.askcodiModelSelect.innerHTML = '';
    if (this.isLoadingAskcodiModels) {
      this.askcodiModelSelect.appendChild(new Option('Loading AskCodi models...', ''));
      return;
    }
    if (this.askcodiModelError) {
      this.askcodiModelSelect.appendChild(new Option('Failed to load models', ''));
      return;
    }
    if (this.askcodiModels.length === 0) {
      this.askcodiModelSelect.appendChild(new Option('No models available', ''));
      return;
    }
    this.askcodiModels.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((model) => {
      this.askcodiModelSelect.appendChild(new Option(model.name, model.id));
    });
    const selectedModel = this.askcodiModels.find((model) => model.id === previousSelection)?.id || this.askcodiModels[0].id;
    this.askcodiModelSelect.value = selectedModel;
    this.modelInput.value = selectedModel;
  }

  /**
   * Fetch and render the recent models dropdown for a given provider baseUrl.
   */
  async refreshRecentModels(baseUrl) {
    if (!this.recentModelsSection || !this.recentModelSelect) return;
    try {
      const response = await fetch(`/api/provider-config/key?baseUrl=${encodeURIComponent(baseUrl)}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      const recent = Array.isArray(data.recentModels) ? data.recentModels : [];
      this.recentModelSelect.innerHTML = '';
      if (recent.length === 0) {
        this.recentModelsSection.classList.add('hidden');
        return;
      }
      this.recentModelsSection.classList.remove('hidden');
      this.recentModelSelect.appendChild(new Option('Recent models...', ''));
      recent.forEach(m => this.recentModelSelect.appendChild(new Option(m, m)));
      // Pre-select current model if it's in the list
      const currentModel = this.modelInput.value.trim();
      if (recent.includes(currentModel)) {
        this.recentModelSelect.value = currentModel;
      }
    } catch (e) {
      this.recentModelsSection.classList.add('hidden');
    }
  }

  updateConnectionStatus(connected) {
    const dot = this.connectionStatus.querySelector('span');
    const text = this.connectionStatus.querySelector('span:last-child');
    if (connected) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500';
      text.textContent = 'Connected';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-red-500';
      text.textContent = 'Disconnected';
    }
  }

  updateApiStatus(configured, config = null) {
    this.apiConfigured = configured;
    if (config) this.currentConfig = config;
    const dot = this.apiStatus.querySelector('span');
    const text = this.apiStatus.querySelector('span:last-child');
    if (configured) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500';
      const modelName = this.currentConfig.model || 'Unknown';
      const provider = this.extractProviderName(this.currentConfig.baseUrl);
      text.textContent = provider ? `${provider} \u00b7 ${modelName}` : `API: ${modelName}`;
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-red-500';
      text.textContent = 'API Not Configured';
    }
  }

  extractProviderName(baseUrl) {
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
    } catch (e) { return ''; }
  }

  handleMessage(data) {
    // Normalize agent index if present
    const agentIndex = data.agentIndex !== undefined ? data.agentIndex : this.normalizeAgentIndex(data.agent);

    switch (data.type) {
      case 'connected':
        this.updateApiStatus(data.apiConfigured, data.config);
        break;
      case 'agent-names':
        this.agentNames = data.names;
        this.agentCount = data.count || Object.keys(data.names).length;
        this.createAgentCards(this.agentCount);
        break;
      case 'status':
        if (data.agent === 'master-handler' || data.agent === 'system') {
          this.addStatusMessage(data.agent, data.message);
          if (data.agent === 'master-handler') this.updateAgentStatus('master-handler', data.message);
        } else {
          this.addStatusMessage(agentIndex, data.message);
          this.updateAgentStatus(agentIndex, data.message);
        }
        break;
      case 'task-breakdown':
        this.addTaskBreakdown(data.message, data.subtasks);
        break;
      case 'streaming':
        this.handleStreamingMessage(agentIndex, data.chunk);
        break;
      case 'stream-end':
        this.handleStreamEnd(agentIndex);
        break;
      case 'task-complete':
        this.updateAgentStatus(agentIndex, 'Completed');
        break;
      case 'agent-result':
        this.agentResults[agentIndex] = data.message;
        this.addAgentResultMessage(agentIndex, data.message, data.round || 1);
        break;
      case 'evaluation':
        this.addEvaluationMessage(data.message, data.satisfied, data.round);
        break;
      case 'follow-up-assignment':
        this.addFollowUpAssignment(data.agentIndex !== undefined ? data.agentIndex : data.target, data.message, data.round);
        break;
      case 'agent-communication':
        this.addAgentCommunicationMessage(data.from, data.to, data.message);
        break;
      case 'agent-question':
        this.addAgentQuestionMessage(data.from, data.to, data.message);
        break;
      case 'agent-answer':
        this.addAgentAnswerMessage(data.from, data.to, data.message);
        break;
      case 'retry':
        this.addRetryMessage(data.agent === 'master-handler' ? 'master-handler' : agentIndex, data.message, data.attempt, data.maxRetries);
        break;
      case 'warning':
        this.addWarningMessage(data.agent === 'master-handler' ? 'master-handler' : agentIndex, data.message);
        break;
      case 'complete':
        this.addFinalResponse(data.message);
        this.updateAgentStatus('master-handler', 'Completed');
        this.isProcessing = false;
        this.submitBtn.disabled = false;
        this.submitBtn.innerHTML = `
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          Execute
        `;
        break;
      case 'error':
        this.addErrorMessage(data.message);
        this.isProcessing = false;
        this.submitBtn.disabled = false;
        this.submitBtn.innerHTML = `
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          Execute
        `;
        // Clean up any active streaming containers
        for (let i = 0; i < this.agentCount; i++) {
          const streamingEl = document.getElementById(`streaming-container-${i}`);
          if (streamingEl) streamingEl.remove();
          delete this.streamingBuffers[i];
        }
        this.updateAgentStatus('master-handler', 'Error');
        break;
    }
  }

  submitTask() {
    const task = this.taskInput.value.trim();
    if (!task) return;
    if (!this.isConnected) { alert('Not connected to server. Please wait...'); return; }
    if (!this.apiConfigured) { this.showModal(); alert('Please configure your API first.'); return; }
    if (this.isProcessing) return;
    
    this.messagesContainer.innerHTML = '';
    this.agentResults = {};
    this.streamingBuffers = {};
    
    this.updateAgentStatus('master-handler', 'Idle');
    for (let i = 0; i < this.agentCount; i++) {
      this.updateAgentStatus(i, 'Idle');
    }
    
    this.addUserMessage(task);
    
    this.isProcessing = true;
    this.submitBtn.disabled = true;
    this.submitBtn.innerHTML = `
      <svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Processing...
    `;
    
    this.ws.send(JSON.stringify({ type: 'task', task }));
    this.taskInput.value = '';
  }

  getAgentLabel(agentId) {
    const normalized = String(agentId || '').toLowerCase();
    if (normalized === 'user') return 'User';
    if (normalized === 'master-handler' || normalized === 'master') return 'Master Handler';
    if (normalized === 'system') return 'System';
    // Try numeric index
    const idx = this.normalizeAgentIndex(agentId);
    if (idx >= 0 && this.agentNames[idx]) return this.agentNames[idx];
    // Legacy
    if (normalized === 'alpha' || normalized === 'sub-agent-alpha') return this.agentNames[0] || 'Agent 0';
    if (normalized === 'beta' || normalized === 'sub-agent-beta') return this.agentNames[1] || 'Agent 1';
    return agentId || 'Unknown';
  }

  makeCollapsible(text, previewLines = 4) {
    const escaped = this.escapeHtml(text);
    const lines = escaped.split('\n');
    if (lines.length <= previewLines + 2) {
      return `<div class="whitespace-pre-wrap">${escaped}</div>`;
    }
    const preview = lines.slice(0, previewLines).join('\n');
    const rest = lines.slice(previewLines).join('\n');
    const remaining = lines.length - previewLines;
    const collapseId = `collapse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return `
      <div class="whitespace-pre-wrap">${preview}</div>
      <div id="${collapseId}" class="hidden whitespace-pre-wrap">${rest}</div>
      <button onclick="(function(btn){
        var el = document.getElementById('${collapseId}');
        if (el.classList.contains('hidden')) {
          el.classList.remove('hidden');
          btn.textContent = '\u25b2 Show less';
        } else {
          el.classList.add('hidden');
          btn.textContent = '\u25bc Show more (${remaining} more lines)';
        }
      })(this)" class="text-xs text-blue-600 hover:text-blue-800 mt-1 font-medium cursor-pointer">\u25bc Show more (${remaining} more lines)</button>
    `;
  }

  showAgentResultModal(agentIndex) {
    const result = this.agentResults[agentIndex];
    if (!result) return;
    const name = this.agentNames[agentIndex] || `Agent ${agentIndex}`;
    this.agentResultModalTitle.textContent = `${name} \u2014 Result`;
    this.agentResultModalBody.textContent = result;
    this.agentResultModal.classList.remove('hidden');
    this.agentResultModal.classList.add('flex');
  }

  hideAgentResultModal() {
    this.agentResultModal.classList.add('hidden');
    this.agentResultModal.classList.remove('flex');
  }

  addUserMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-white rounded-lg p-4 border border-gray-200 shadow-sm';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <div class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
          <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
          </svg>
        </div>
        <span class="font-medium">You</span>
      </div>
      <p class="text-gray-700">${this.escapeHtml(text)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addStatusMessage(agent, message) {
    let agentName, dotColor;
    if (agent === 'master-handler') {
      agentName = 'Master Handler';
      dotColor = 'bg-purple-500';
    } else if (agent === 'system') {
      agentName = 'System';
      dotColor = 'bg-gray-500';
    } else {
      const idx = typeof agent === 'number' ? agent : this.normalizeAgentIndex(agent);
      agentName = this.agentNames[idx] || `Agent ${idx}`;
      dotColor = this.getAgentColors(idx).dot;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter flex items-start gap-3';
    messageDiv.innerHTML = `
      <div class="w-8 h-8 rounded-full ${dotColor} flex items-center justify-center flex-shrink-0">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
      </div>
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-medium text-sm">${agentName}</span>
        </div>
        <p class="text-gray-600 text-sm">${this.escapeHtml(message)}</p>
      </div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addTaskBreakdown(explanation, subtasks) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-white rounded-lg p-4 border border-purple-200 shadow-sm';

    let subtaskHtml = '';
    for (let i = 0; i < subtasks.length; i++) {
      const colors = this.getAgentColors(i);
      const name = this.agentNames[i] || `Agent ${i}`;
      subtaskHtml += `
        <div class="flex items-start gap-2 p-2 rounded ${colors.subtaskBg} border ${colors.subtaskBorder}">
          <span class="${colors.subtaskText} font-medium text-sm">${this.escapeHtml(name)}:</span>
          <span class="text-gray-700 text-sm">${this.escapeHtml(subtasks[i])}</span>
        </div>
      `;
    }

    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <div class="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
        </div>
        <span class="font-medium">Task Breakdown (${subtasks.length} agents)</span>
      </div>
      <p class="text-gray-600 text-sm mb-3">${this.escapeHtml(explanation)}</p>
      <div class="space-y-2">
        ${subtaskHtml}
      </div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  handleStreamingMessage(agentIndex, chunk) {
    if (!this.streamingBuffers[agentIndex]) {
      this.streamingBuffers[agentIndex] = '';
    }
    this.streamingBuffers[agentIndex] += chunk;

    let container = document.getElementById(`streaming-container-${agentIndex}`);
    const colors = this.getAgentColors(agentIndex);
    const name = this.agentNames[agentIndex] || `Agent ${agentIndex}`;
    
    if (!container) {
      container = document.createElement('div');
      container.id = `streaming-container-${agentIndex}`;
      container.className = `message-enter ${colors.bg} rounded-lg border ${colors.border} shadow-sm overflow-hidden`;
      container.innerHTML = `
        <div class="flex items-center gap-2 px-4 py-3 ${colors.headerBg}">
          <div class="w-6 h-6 rounded-full ${colors.dot} flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <span class="font-medium text-sm ${colors.text}">${this.escapeHtml(name)}</span>
          <span class="streaming-indicator text-xs ${colors.text} opacity-70 flex items-center gap-1">
            <span class="inline-block w-1.5 h-1.5 rounded-full ${colors.dot} animate-pulse"></span>
            Streaming...
          </span>
        </div>
        <div id="streaming-body-${agentIndex}" class="px-4 py-3 border-t ${colors.border}">
          <div id="streaming-content-${agentIndex}" class="md-prose text-gray-800 text-sm"></div>
          <span class="streaming-cursor"></span>
        </div>
      `;
      this.messagesContainer.appendChild(container);
    }
    
    const contentEl = document.getElementById(`streaming-content-${agentIndex}`);
    if (contentEl) {
      contentEl.innerHTML = this.renderMarkdown(this.streamingBuffers[agentIndex]);
    }
    this.scrollToBottom();
  }

  handleStreamEnd(agentIndex) {
    const container = document.getElementById(`streaming-container-${agentIndex}`);
    if (container) {
      const cursor = container.querySelector('.streaming-cursor');
      if (cursor) cursor.remove();
      const indicator = container.querySelector('.streaming-indicator');
      if (indicator) {
        indicator.innerHTML = '<span class="text-xs opacity-60">\u2713 Complete</span>';
      }
    }
    delete this.streamingBuffers[agentIndex];
  }

  addFinalResponse(message) {
    document.querySelectorAll('.retry-message').forEach(el => el.remove());
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-gradient-to-r from-purple-50 to-white rounded-lg p-4 border border-purple-200 shadow-sm';
    const rendered = this.renderMarkdown(message);
    messageDiv.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <span class="font-semibold">Final Synthesis</span>
        </div>
      </div>
      <div class="md-prose text-gray-800 text-sm">${rendered}</div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      try { return marked.parse(text); } catch (e) { /* fallback */ }
    }
    return `<div class="whitespace-pre-wrap">${this.escapeHtml(text)}</div>`;
  }

  addErrorMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-red-50 border border-red-200 rounded-lg p-4';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span class="font-medium text-red-600">Error</span>
      </div>
      <p class="text-gray-700 text-sm">${this.escapeHtml(message)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
    this.updateAgentStatus('master-handler', 'Error');
  }

  addAgentCommunicationMessage(from, to, message) {
    const fromName = this.getAgentLabel(from);
    const toName = this.getAgentLabel(to);
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-indigo-50 border border-indigo-200 rounded-lg p-3';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        </svg>
        <span class="text-sm font-medium text-indigo-700">Agent Communication</span>
        <span class="text-xs text-indigo-500">${fromName} \u2192 ${toName}</span>
      </div>
      <p class="text-gray-700 text-sm">${this.makeCollapsible(message, 4)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addAgentQuestionMessage(from, to, message) {
    const fromName = this.getAgentLabel(from);
    const toName = this.getAgentLabel(to);
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-amber-50 border border-amber-300 rounded-lg p-3';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <svg class="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span class="text-sm font-medium text-amber-700">Question</span>
        <span class="text-xs text-amber-600">${fromName} \u2192 ${toName}</span>
      </div>
      <div class="text-gray-700 text-sm italic">${this.makeCollapsible(message, 3)}</div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addAgentAnswerMessage(from, to, message) {
    const fromName = this.getAgentLabel(from);
    const toName = this.getAgentLabel(to);
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-teal-50 border border-teal-300 rounded-lg p-3';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <svg class="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span class="text-sm font-medium text-teal-700">Answer</span>
        <span class="text-xs text-teal-600">${fromName} \u2192 ${toName}</span>
      </div>
      <div class="text-gray-700 text-sm">${this.makeCollapsible(message, 4)}</div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addAgentResultMessage(agentIndex, message, round = 1) {
    const streamingContainer = document.getElementById(`streaming-container-${agentIndex}`);
    if (streamingContainer) streamingContainer.remove();
    delete this.streamingBuffers[agentIndex];

    const colors = this.getAgentColors(agentIndex);
    const name = this.agentNames[agentIndex] || `Agent ${agentIndex}`;
    const roundLabel = round > 1 ? ` (Follow-up Round ${round - 1})` : '';
    const collapseId = `result-${agentIndex}-${Date.now()}`;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message-enter ${colors.bg} rounded-lg border ${colors.border} shadow-sm overflow-hidden`;
    messageDiv.innerHTML = `
      <button
        onclick="(function(btn){
          var content = document.getElementById('${collapseId}');
          var chevron = btn.querySelector('.chevron-icon');
          if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            chevron.style.transform = 'rotate(180deg)';
          } else {
            content.classList.add('hidden');
            chevron.style.transform = 'rotate(0deg)';
          }
        })(this)"
        class="w-full flex items-center justify-between px-4 py-3 ${colors.headerBg} hover:opacity-90 transition-opacity cursor-pointer"
      >
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full ${colors.badge} flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
          <span class="font-medium text-sm ${colors.text}">${name} \u2014 Completed Result${roundLabel}</span>
          <span class="text-xs ${colors.text} opacity-60">(click to expand)</span>
        </div>
        <svg class="chevron-icon w-4 h-4 ${colors.text} transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      <div id="${collapseId}" class="hidden px-4 py-3 border-t ${colors.border}">
        <div class="text-gray-800 text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">${this.escapeHtml(message)}</div>
      </div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addEvaluationMessage(reasoning, satisfied, round) {
    const icon = satisfied
      ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>'
      : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>';
    const borderColor = satisfied ? 'border-green-300' : 'border-orange-300';
    const bgColor = satisfied ? 'bg-green-50' : 'bg-orange-50';
    const iconColor = satisfied ? 'text-green-500' : 'text-orange-500';
    const badgeColor = satisfied ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700';
    const verdictText = satisfied ? 'Satisfied' : 'Needs Follow-up';

    const messageDiv = document.createElement('div');
    messageDiv.className = `message-enter ${bgColor} rounded-lg border ${borderColor} p-4 shadow-sm`;
    messageDiv.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          <svg class="w-5 h-5 ${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icon}</svg>
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold text-sm text-gray-800">Master Handler \u2014 Evaluation</span>
            <span class="text-xs px-2 py-0.5 rounded-full ${badgeColor} font-medium">${verdictText}</span>
            <span class="text-xs text-gray-400">Round ${round}</span>
          </div>
          <div class="text-gray-700 text-sm">${this.makeCollapsible(reasoning, 3)}</div>
        </div>
      </div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addFollowUpAssignment(agentIndex, task, round) {
    const idx = typeof agentIndex === 'number' ? agentIndex : this.normalizeAgentIndex(agentIndex);
    const colors = this.getAgentColors(idx);
    const name = this.agentNames[idx] || `Agent ${idx}`;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message-enter p-3 rounded-lg border ${colors.border} ${colors.bg} shadow-sm`;
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <div class="w-5 h-5 rounded-full ${colors.dot} flex items-center justify-center">
          <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
        </div>
        <span class="text-sm font-medium text-gray-700">Follow-up assigned to ${name}</span>
        <span class="text-xs text-gray-400">Round ${round}</span>
      </div>
      <div class="text-gray-600 text-sm">${this.makeCollapsible(task, 3)}</div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addRetryMessage(agent, message, attempt, maxRetries) {
    let displayName;
    if (agent === 'master-handler') {
      displayName = 'Master Handler';
    } else {
      const idx = typeof agent === 'number' ? agent : this.normalizeAgentIndex(agent);
      displayName = this.agentNames[idx] || `Agent ${idx}`;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter retry-message bg-amber-50 border border-amber-200 rounded-lg p-3';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <svg class="w-4 h-4 text-amber-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        <span class="text-sm font-medium text-amber-700">${displayName}</span>
        <span class="text-xs text-amber-600">Retry ${attempt}/${maxRetries}</span>
      </div>
      <p class="text-gray-600 text-sm">${this.escapeHtml(message)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  addWarningMessage(agent, message) {
    let displayName;
    if (agent === 'master-handler') {
      displayName = 'Master Handler';
    } else {
      const idx = typeof agent === 'number' ? agent : this.normalizeAgentIndex(agent);
      displayName = this.agentNames[idx] || `Agent ${idx}`;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-yellow-50 border border-yellow-300 rounded-lg p-3';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <svg class="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <span class="text-sm font-medium text-yellow-700">Warning from ${displayName}</span>
      </div>
      <p class="text-gray-600 text-sm">${this.escapeHtml(message)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  updateAgentStatus(agent, status) {
    if (agent === 'master-handler') {
      const el = document.getElementById('master-status');
      if (el) el.textContent = status;
      return;
    }
    const idx = typeof agent === 'number' ? agent : this.normalizeAgentIndex(agent);
    const statusEl = document.getElementById(`agent-status-${idx}`);
    if (statusEl) statusEl.textContent = status;

    // Update card clickability
    const cardEl = document.getElementById(`agent-card-${idx}`);
    if (cardEl && this.agentResults[idx]) {
      cardEl.classList.add('cursor-pointer', 'hover:bg-gray-100', 'hover:border-gray-300');
    }
  }

  async showModal() {
    this.settingsModal.classList.remove('hidden');
    this.settingsModal.classList.add('flex');

    const savedConfig = await this.fetchSavedConfig();
    const baseUrl = (savedConfig.baseUrl || this.apiUrlInput.value.trim() || 'https://api.openai.com/v1').trim();
    this.apiUrlInput.value = baseUrl;

    const savedModel = await this.fetchModelForProvider(baseUrl) || savedConfig.model;
    if (savedModel) this.modelInput.value = savedModel;

    const savedApiKey = await this.fetchApiKeyForProvider(baseUrl);
    this.apiKeyInput.value = savedApiKey || '';

    this.syncPresetToBaseUrl(baseUrl);
    this.refreshOpenRouterModelSection(baseUrl, true);
    this.refreshRecentModels(baseUrl);
    this.apiKeyInput.focus();
  }

  hideModal() {
    this.settingsModal.classList.add('hidden');
    this.settingsModal.classList.remove('flex');
  }

  async saveApiConfig() {
    const apiKey = this.apiKeyInput.value.trim();
    const baseUrl = this.apiUrlInput.value.trim() || 'https://api.openai.com/v1';
    const model = this.modelInput.value.trim() || 'gpt-4o-mini';
    if (!apiKey) { alert('Please enter an API key'); return; }
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl, model })
      });
      if (response.ok) {
        const data = await response.json();
        this.updateApiStatus(true, { baseUrl: data.baseUrl, model: data.model });
        this.hideModal();
        this.addStatusMessage('system', `API configured: ${data.baseUrl} with model ${data.model}`);
        await this.saveProviderConfigToServer(baseUrl, model, apiKey);
      } else {
        const data = await response.json();
        alert('Error: ' + data.error);
      }
    } catch (error) { alert('Error saving API config: ' + error.message); }
  }
  
  async saveProviderConfigToServer(baseUrl, model, apiKey) {
    try {
      await fetch('/api/provider-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl, model })
      });
    } catch (e) {
      console.error('Failed to save provider config:', e.message);
    }
  }

  async fetchSavedConfig() {
    try {
      const response = await fetch('/api/provider-config');
      if (response.ok) return await response.json();
    } catch (e) {
      console.error('Failed to fetch provider config:', e.message);
    }
    return {};
  }
  
  getProviderKey(baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (url.hostname.includes('openrouter')) return 'openrouter';
      if (url.hostname.includes('deepseek')) return 'deepseek';
      if (url.hostname.includes('nvidia')) return 'nvidia';
      if (url.hostname.includes('strongwall')) return 'strongwall';
      if (url.hostname.includes('groq')) return 'groq';
      if (url.hostname.includes('askcodi')) return 'askcodi';
      if (url.hostname.includes('ollama')) return 'ollama';
      if (url.hostname.includes('lmstudio')) return 'lmstudio';
      if (url.hostname.includes('openai')) return 'openai';
      return url.hostname;
    } catch (e) { return 'custom'; }
  }
  
  async fetchApiKeyForProvider(baseUrl) {
    try {
      const response = await fetch(`/api/provider-config/key?baseUrl=${encodeURIComponent(baseUrl)}`);
      if (response.ok) {
        const data = await response.json();
        return data.apiKey || '';
      }
    } catch (e) {
      console.error('Failed to fetch API key for provider:', e.message);
    }
    return '';
  }

  async fetchModelForProvider(baseUrl) {
    try {
      const response = await fetch(`/api/provider-config/key?baseUrl=${encodeURIComponent(baseUrl)}`);
      if (response.ok) {
        const data = await response.json();
        return data.model || '';
      }
    } catch (e) {
      console.error('Failed to fetch model for provider:', e.message);
    }
    return '';
  }
  
  async loadSavedConfig() {
    const config = await this.fetchSavedConfig();
    if (!config || !config.activeProvider) return null;
    // Find the active provider from the providers array
    const active = (config.providers || []).find(p => p.name === config.activeProvider);
    const baseUrl = active ? active.baseUrl : 'https://api.openai.com/v1';
    this.apiUrlInput.value = baseUrl;
    this.syncPresetToBaseUrl(baseUrl);
    const model = await this.fetchModelForProvider(baseUrl) || (active ? active.model : '');
    if (model) this.modelInput.value = model;
    const apiKey = await this.fetchApiKeyForProvider(baseUrl);
    this.apiKeyInput.value = apiKey || '';
    this.refreshRecentModels(baseUrl);
    return config;
  }
  
  async testConnection() {
    const apiKey = this.apiKeyInput.value.trim();
    const baseUrl = this.apiUrlInput.value.trim() || 'https://api.openai.com/v1';
    const model = this.modelInput.value.trim() || 'gpt-4o-mini';
    if (!apiKey) { alert('Please enter an API key first'); return; }
    const originalText = this.testConnectionBtn.textContent;
    this.testConnectionBtn.textContent = 'Testing...';
    this.testConnectionBtn.disabled = true;
    try {
      const response = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl, model })
      });
      const data = await response.json();
      if (data.success) {
        alert('\u2705 Connection successful!\n\nModel: ' + model + '\nResponse: ' + data.response.substring(0, 100) + '...');
      } else {
        alert('\u274c Connection failed!\n\nError: ' + data.error);
      }
    } catch (error) {
      alert('\u274c Connection failed!\n\nError: ' + error.message);
    } finally {
      this.testConnectionBtn.textContent = originalText;
      this.testConnectionBtn.disabled = false;
    }
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new AgentDashboard();
});
