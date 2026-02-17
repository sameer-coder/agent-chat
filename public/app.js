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
    
    // Agent result modal
    this.agentResultModal = document.getElementById('agent-result-modal');
    this.agentResultModalTitle = document.getElementById('agent-result-modal-title');
    this.agentResultModalBody = document.getElementById('agent-result-modal-body');
    this.closeAgentResultModalBtn = document.getElementById('close-agent-result-modal');
    
    // Agent cards
    this.alphaCard = document.getElementById('alpha-card');
    this.betaCard = document.getElementById('beta-card');
    
    // Store latest agent results for modal viewing
    this.agentResults = { alpha: null, beta: null };
    
    // Dynamic agent names (updated from server each task)
    this.agentNames = { alpha: 'Agent Alpha', beta: 'Agent Beta' };
    
    // Streaming state: accumulates raw text for each agent during streaming
    this.streamingBuffers = {};
    
    this.isConnected = false;
    this.isProcessing = false;
    this.apiConfigured = false;
    this.openRouterModels = [];
    this.isLoadingOpenRouterModels = false;
    this.openRouterModelError = '';
    this.currentConfig = {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    };
    
    this.init();
  }

  init() {
    this.connectWebSocket();
    this.bindEvents();
    this.loadFromLocalStorage();
    this.refreshOpenRouterModelSection(this.apiUrlInput.value.trim(), false);
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
      // Reconnect after 3 seconds
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
    // Submit task
    this.submitBtn.addEventListener('click', () => this.submitTask());
    this.taskInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitTask();
      }
    });
    
    // Settings modal
    this.settingsBtn.addEventListener('click', () => this.showModal());
    this.closeModalBtn.addEventListener('click', () => this.hideModal());
    this.cancelModalBtn.addEventListener('click', () => this.hideModal());
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.hideModal();
    });
    
    // Save API configuration
    this.saveApiKeyBtn.addEventListener('click', () => this.saveApiConfig());
    this.apiKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.saveApiConfig();
    });
    
    // Test connection
    this.testConnectionBtn.addEventListener('click', () => this.testConnection());
    
    // Preset dropdown
    if (this.presetSelect) {
      this.presetSelect.addEventListener('change', () => this.handlePresetChange());
    }
    
    // OpenRouter model selection
    if (this.freeModelSelect) {
      this.freeModelSelect.addEventListener('change', () => {
        if (this.freeModelSelect.value) {
          this.modelInput.value = this.freeModelSelect.value;
        }
      });
    }

    // OpenRouter free-only toggle
    if (this.freeOnlyCheckbox) {
      this.freeOnlyCheckbox.addEventListener('change', () => {
        this.renderOpenRouterModelOptions();
      });
    }

    // Agent card click → open result modal
    if (this.alphaCard) {
      this.alphaCard.addEventListener('click', () => this.showAgentResultModal('alpha'));
    }
    if (this.betaCard) {
      this.betaCard.addEventListener('click', () => this.showAgentResultModal('beta'));
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
    
    // Load API key when base URL changes
    this.apiUrlInput.addEventListener('change', () => {
      const baseUrl = this.apiUrlInput.value.trim();
      if (baseUrl) {
        const savedModel = this.loadModelForProvider(baseUrl);
        if (savedModel) {
          this.modelInput.value = savedModel;
        }
        this.syncPresetToBaseUrl(baseUrl);
        this.refreshOpenRouterModelSection(baseUrl, true);
        
        const savedApiKey = this.loadApiKeyForProvider(baseUrl);
        if (savedApiKey) {
          this.apiKeyInput.value = savedApiKey;
        } else {
          this.apiKeyInput.value = '';
        }
      }
    });
  }

  parsePresetValue(value) {
    const separatorIndex = value.indexOf('|');
    if (separatorIndex === -1) {
      return [value, ''];
    }

    return [
      value.slice(0, separatorIndex),
      value.slice(separatorIndex + 1)
    ];
  }

  syncPresetToBaseUrl(baseUrl) {
    if (!this.presetSelect || !baseUrl) {
      return;
    }

    const matchingOption = Array.from(this.presetSelect.options).find((option) => {
      if (!option.value) {
        return false;
      }
      const [presetBaseUrl] = this.parsePresetValue(option.value);
      return presetBaseUrl === baseUrl;
    });

    this.presetSelect.value = matchingOption ? matchingOption.value : '';
  }

  handlePresetChange() {
    const value = this.presetSelect?.value || '';
    if (!value) {
      return;
    }

    const [baseUrl, model] = this.parsePresetValue(value);
    this.apiUrlInput.value = baseUrl;
    const savedModel = this.loadModelForProvider(baseUrl);
    this.modelInput.value = savedModel || model || this.modelInput.value || 'gpt-4o-mini';

    this.refreshOpenRouterModelSection(baseUrl, true);

    const savedApiKey = this.loadApiKeyForProvider(baseUrl);
    if (savedApiKey) {
      this.apiKeyInput.value = savedApiKey;
    } else {
      this.apiKeyInput.value = '';
    }
  }

  isOpenRouterProvider(baseUrl) {
    return baseUrl.includes('openrouter.ai');
  }

  async refreshOpenRouterModelSection(baseUrl, forceRefresh = true) {
    if (!this.freeModelsSection) {
      return;
    }

    if (this.isOpenRouterProvider(baseUrl)) {
      this.freeModelsSection.classList.remove('hidden');
      await this.loadOpenRouterModels(forceRefresh);
      return;
    }

    this.freeModelsSection.classList.add('hidden');
  }

  async loadOpenRouterModels(forceRefresh = false) {
    if (this.isLoadingOpenRouterModels) {
      return;
    }

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
      if (apiKey) {
        headers['X-OpenRouter-Api-Key'] = apiKey;
      }

      const response = await fetch('/api/openrouter/models', { headers });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch OpenRouter models');
      }

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
    if (!freeOnly) {
      return this.openRouterModels;
    }

    return this.openRouterModels.filter((model) => model.isFree);
  }

  renderOpenRouterModelOptions() {
    if (!this.freeModelSelect) {
      return;
    }

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
      const emptyMessage = (this.freeOnlyCheckbox?.checked ?? true)
        ? 'No free models available'
        : 'No models available';
      this.freeModelSelect.appendChild(new Option(emptyMessage, ''));
      return;
    }

    models
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((model) => {
        const priceTag = model.isFree ? ' (Free)' : '';
        this.freeModelSelect.appendChild(new Option(`${model.name}${priceTag}`, model.id));
      });

    const selectedModel = models.find((model) => model.id === previousSelection)?.id || models[0].id;
    this.freeModelSelect.value = selectedModel;
    this.modelInput.value = selectedModel;
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
    if (config) {
      this.currentConfig = config;
    }
    
    const dot = this.apiStatus.querySelector('span');
    const text = this.apiStatus.querySelector('span:last-child');
    
    if (configured) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500';
      const modelName = this.currentConfig.model || 'Unknown';
      const provider = this.extractProviderName(this.currentConfig.baseUrl);
      text.textContent = provider ? `${provider} · ${modelName}` : `API: ${modelName}`;
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-red-500';
      text.textContent = 'API Not Configured';
    }
  }

  /**
   * Extract a human-friendly provider name from the API base URL
   */
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
      if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
        if (baseUrl.includes('11434')) return 'Ollama';
        if (baseUrl.includes('1234')) return 'LM Studio';
        return 'Local';
      }
      // Use the domain name itself as fallback
      const parts = hostname.replace('www.', '').split('.');
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    } catch (e) {
      return '';
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'connected':
        this.updateApiStatus(data.apiConfigured, data.config);
        break;
      case 'agent-names':
        this.agentNames = data.names;
        this.updateSidebarAgentNames();
        break;
      case 'status':
        this.addStatusMessage(data.agent, data.message);
        this.updateAgentStatus(data.agent, data.message);
        break;
      case 'task-breakdown':
        this.addTaskBreakdown(data.message, data.subtasks);
        break;
      case 'streaming':
        this.handleStreamingMessage(data.agent, data.chunk);
        break;
      case 'stream-end':
        this.handleStreamEnd(data.agent);
        break;
      case 'task-complete':
        this.updateAgentStatus(data.agent, 'Completed');
        break;
      case 'agent-result':
        this.agentResults[data.agent] = data.message;
        this.addAgentResultMessage(data.agent, data.message, data.round || 1);
        break;
      case 'evaluation':
        this.addEvaluationMessage(data.message, data.satisfied, data.round);
        break;
      case 'follow-up-assignment':
        this.addFollowUpAssignment(data.target, data.message, data.round);
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
        this.addRetryMessage(data.agent, data.message, data.attempt, data.maxRetries);
        break;
      case 'warning':
        this.addWarningMessage(data.agent, data.message);
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
        for (const agent of ['alpha', 'beta']) {
          const streamingEl = document.getElementById(`streaming-container-${agent}`);
          if (streamingEl) streamingEl.remove();
          delete this.streamingBuffers[agent];
        }
        // Reset sidebar statuses
        this.updateAgentStatus('master-handler', 'Error');
        break;
    }
  }

  submitTask() {
    const task = this.taskInput.value.trim();
    
    if (!task) return;
    if (!this.isConnected) {
      alert('Not connected to server. Please wait...');
      return;
    }
    if (!this.apiConfigured) {
      this.showModal();
      alert('Please configure your API first.');
      return;
    }
    if (this.isProcessing) return;
    
    // Clear previous messages
    this.messagesContainer.innerHTML = '';
    this.agentResults = { alpha: null, beta: null };
    this.streamingBuffers = {};
    
    // Reset sidebar agent statuses
    this.updateAgentStatus('master-handler', 'Idle');
    this.updateAgentStatus('alpha', 'Idle');
    this.updateAgentStatus('beta', 'Idle');
    
    // Reset agent card clickability
    if (this.alphaCard) {
      this.alphaCard.classList.remove('cursor-pointer', 'hover:bg-gray-100', 'hover:border-gray-300');
    }
    if (this.betaCard) {
      this.betaCard.classList.remove('cursor-pointer', 'hover:bg-gray-100', 'hover:border-gray-300');
    }
    
    // Add initial task message
    this.addUserMessage(task);
    
    // Send task to server
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

  /**
   * Get a human-readable agent label
   */
  getAgentLabel(agentId) {
    const normalized = String(agentId || '').toLowerCase();
    if (normalized === 'user') return 'User';
    if (normalized === 'master-handler' || normalized === 'master') return 'Master Handler';
    if (normalized === 'alpha' || normalized === 'sub-agent-alpha') return this.agentNames.alpha;
    if (normalized === 'beta' || normalized === 'sub-agent-beta') return this.agentNames.beta;
    if (normalized === 'system') return 'System';
    return agentId || 'Unknown';
  }

  /**
   * Create collapsible text for long content. Shows first few lines with expand toggle.
   * @param {string} text - The raw text
   * @param {number} previewLines - Number of lines to show before collapsing
   * @returns {string} HTML string
   */
  makeCollapsible(text, previewLines = 4) {
    const escaped = this.escapeHtml(text);
    const lines = escaped.split('\n');
    if (lines.length <= previewLines + 2) {
      // Not long enough to collapse
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
          btn.textContent = '▲ Show less';
        } else {
          el.classList.add('hidden');
          btn.textContent = '▼ Show more (${remaining} more lines)';
        }
      })(this)" class="text-xs text-blue-600 hover:text-blue-800 mt-1 font-medium cursor-pointer">▼ Show more (${remaining} more lines)</button>
    `;
  }

  /**
   * Show agent result modal
   */
  showAgentResultModal(agent) {
    const result = this.agentResults[agent];
    if (!result) return;
    const name = this.agentNames[agent] || agent;
    this.agentResultModalTitle.textContent = `${name} — Result`;
    this.agentResultModalBody.textContent = result;
    this.agentResultModal.classList.remove('hidden');
    this.agentResultModal.classList.add('flex');
  }

  /**
   * Hide agent result modal
   */
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
    const agentNames = {
      'master-handler': 'Master Handler',
      'alpha': this.agentNames.alpha,
      'beta': this.agentNames.beta,
      'system': 'System'
    };
    
    const agentColors = {
      'master-handler': 'bg-purple-500',
      'alpha': 'bg-cyan-500',
      'beta': 'bg-emerald-500',
      'system': 'bg-gray-500'
    };
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter flex items-start gap-3';
    messageDiv.innerHTML = `
      <div class="w-8 h-8 rounded-full ${agentColors[agent]} flex items-center justify-center flex-shrink-0">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
      </div>
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-medium text-sm">${agentNames[agent] || agent}</span>
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
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <div class="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
        </div>
        <span class="font-medium">Task Breakdown</span>
      </div>
      <p class="text-gray-600 text-sm mb-3">${this.escapeHtml(explanation)}</p>
      <div class="space-y-2">
        <div class="flex items-start gap-2 p-2 rounded bg-cyan-50 border border-cyan-200">
          <span class="text-cyan-600 font-medium text-sm">${this.escapeHtml(this.agentNames.alpha)}:</span>
          <span class="text-gray-700 text-sm">${this.escapeHtml(subtasks[0])}</span>
        </div>
        <div class="flex items-start gap-2 p-2 rounded bg-emerald-50 border border-emerald-200">
          <span class="text-emerald-600 font-medium text-sm">${this.escapeHtml(this.agentNames.beta)}:</span>
          <span class="text-gray-700 text-sm">${this.escapeHtml(subtasks[1])}</span>
        </div>
      </div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  /**
   * Update sidebar agent cards with dynamic names
   */
  updateSidebarAgentNames() {
    const alphaNameEl = document.getElementById('alpha-name');
    const betaNameEl = document.getElementById('beta-name');
    if (alphaNameEl) alphaNameEl.textContent = this.agentNames.alpha;
    if (betaNameEl) betaNameEl.textContent = this.agentNames.beta;
  }

  handleStreamingMessage(agent, chunk) {
    // Initialize buffer for this agent if needed
    if (!this.streamingBuffers[agent]) {
      this.streamingBuffers[agent] = '';
    }
    this.streamingBuffers[agent] += chunk;

    let container = document.getElementById(`streaming-container-${agent}`);
    
    const agentColors = {
      'alpha': { border: 'border-cyan-300', bg: 'bg-cyan-50', dot: 'bg-cyan-500', text: 'text-cyan-700', headerBg: 'bg-cyan-100' },
      'beta': { border: 'border-emerald-300', bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-700', headerBg: 'bg-emerald-100' }
    };
    const colors = agentColors[agent] || agentColors['alpha'];
    
    if (!container) {
      container = document.createElement('div');
      container.id = `streaming-container-${agent}`;
      container.className = `message-enter ${colors.bg} rounded-lg border ${colors.border} shadow-sm overflow-hidden`;
      container.innerHTML = `
        <div class="flex items-center gap-2 px-4 py-3 ${colors.headerBg}">
          <div class="w-6 h-6 rounded-full ${colors.dot} flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <span class="font-medium text-sm ${colors.text}">${this.escapeHtml(this.agentNames[agent] || agent)}</span>
          <span class="streaming-indicator text-xs ${colors.text} opacity-70 flex items-center gap-1">
            <span class="inline-block w-1.5 h-1.5 rounded-full ${colors.dot} animate-pulse"></span>
            Streaming...
          </span>
        </div>
        <div id="streaming-body-${agent}" class="px-4 py-3 border-t ${colors.border}">
          <div id="streaming-content-${agent}" class="md-prose text-gray-800 text-sm"></div>
          <span class="streaming-cursor"></span>
        </div>
      `;
      this.messagesContainer.appendChild(container);
    }
    
    // Render accumulated markdown
    const contentEl = document.getElementById(`streaming-content-${agent}`);
    if (contentEl) {
      contentEl.innerHTML = this.renderMarkdown(this.streamingBuffers[agent]);
    }
    this.scrollToBottom();
  }

  handleStreamEnd(agent) {
    // Remove the cursor from the streaming container
    const container = document.getElementById(`streaming-container-${agent}`);
    if (container) {
      const cursor = container.querySelector('.streaming-cursor');
      if (cursor) cursor.remove();
      const indicator = container.querySelector('.streaming-indicator');
      if (indicator) {
        indicator.innerHTML = '<span class="text-xs opacity-60">✓ Complete</span>';
      }
    }
    // Clear the streaming buffer
    delete this.streamingBuffers[agent];
  }

  addFinalResponse(message) {
    // Remove any lingering retry messages before showing the final result
    document.querySelectorAll('.retry-message').forEach(el => el.remove());

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-gradient-to-r from-purple-50 to-white rounded-lg p-4 border border-purple-200 shadow-sm';

    // Render markdown
    const rendered = this.renderMarkdown(message);
    const collapseId = `final-${Date.now()}`;

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

  /**
   * Render markdown text to HTML using marked.js
   */
  renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      try {
        return marked.parse(text);
      } catch (e) {
        // Fallback to escaped text
        return `<div class="whitespace-pre-wrap">${this.escapeHtml(text)}</div>`;
      }
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

  /**
   * Add an inter-agent communication message
   */
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
        <span class="text-xs text-indigo-500">${fromName} → ${toName}</span>
      </div>
      <p class="text-gray-700 text-sm">${this.makeCollapsible(message, 4)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  /**
   * Add an inter-agent question message
   */
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
        <span class="text-xs text-amber-600">${fromName} → ${toName}</span>
      </div>
      <div class="text-gray-700 text-sm italic">${this.makeCollapsible(message, 3)}</div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  /**
   * Add an inter-agent answer message
   */
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
        <span class="text-xs text-teal-600">${fromName} → ${toName}</span>
      </div>
      <div class="text-gray-700 text-sm">${this.makeCollapsible(message, 4)}</div>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  /**
   * Add a collapsible sub-agent result message
   */
  addAgentResultMessage(agent, message, round = 1) {
    // Remove the streaming container for this agent since we now have the final result
    const streamingContainer = document.getElementById(`streaming-container-${agent}`);
    if (streamingContainer) {
      streamingContainer.remove();
    }
    // Clear any leftover streaming buffer
    delete this.streamingBuffers[agent];

    const agentColors = {
      'alpha': { border: 'border-cyan-300', bg: 'bg-cyan-50', badge: 'bg-cyan-500', text: 'text-cyan-700', headerBg: 'bg-cyan-100' },
      'beta': { border: 'border-emerald-300', bg: 'bg-emerald-50', badge: 'bg-emerald-500', text: 'text-emerald-700', headerBg: 'bg-emerald-100' }
    };
    const colors = agentColors[agent] || agentColors['alpha'];
    const name = this.agentNames[agent] || agent;
    const roundLabel = round > 1 ? ` (Follow-up Round ${round - 1})` : '';
    const collapseId = `result-${agent}-${Date.now()}`;

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
          <span class="font-medium text-sm ${colors.text}">${name} — Completed Result${roundLabel}</span>
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

  /**
   * Add an evaluation result message from the master handler
   */
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
          <svg class="w-5 h-5 ${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            ${icon}
          </svg>
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold text-sm text-gray-800">Master Handler — Evaluation</span>
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

  /**
   * Add a follow-up task assignment message
   */
  addFollowUpAssignment(agent, task, round) {
    const agentColors = {
      'alpha': 'border-cyan-300 bg-cyan-50',
      'beta': 'border-emerald-300 bg-emerald-50'
    };
    const dotColor = agent === 'alpha' ? 'bg-cyan-500' : 'bg-emerald-500';
    const name = this.agentNames[agent] || agent;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message-enter p-3 rounded-lg border ${agentColors[agent]} shadow-sm`;
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <div class="w-5 h-5 rounded-full ${dotColor} flex items-center justify-center">
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

  /**
   * Add a retry message
   */
  addRetryMessage(agent, message, attempt, maxRetries) {
    const agentDisplayNames = {
      'master-handler': 'Master Handler',
      'alpha': this.agentNames.alpha,
      'beta': this.agentNames.beta
    };
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter retry-message bg-amber-50 border border-amber-200 rounded-lg p-3';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <svg class="w-4 h-4 text-amber-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        <span class="text-sm font-medium text-amber-700">${agentDisplayNames[agent] || agent}</span>
        <span class="text-xs text-amber-600">Retry ${attempt}/${maxRetries}</span>
      </div>
      <p class="text-gray-600 text-sm">${this.escapeHtml(message)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  /**
   * Add a warning message
   */
  addWarningMessage(agent, message) {
    const agentDisplayNames = {
      'master-handler': 'Master Handler',
      'alpha': this.agentNames.alpha,
      'beta': this.agentNames.beta
    };
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-enter bg-yellow-50 border border-yellow-300 rounded-lg p-3';
    messageDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <svg class="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <span class="text-sm font-medium text-yellow-700">Warning from ${agentDisplayNames[agent] || agent}</span>
      </div>
      <p class="text-gray-600 text-sm">${this.escapeHtml(message)}</p>
    `;
    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();
  }

  updateAgentStatus(agent, status) {
    const statusElements = {
      'master-handler': document.getElementById('master-status'),
      'alpha': document.getElementById('alpha-status'),
      'beta': document.getElementById('beta-status')
    };
    
    const statusEl = statusElements[agent];
    if (statusEl) {
      statusEl.textContent = status;
    }

    // Update card clickability for sub-agents
    const cardEl = agent === 'alpha' ? this.alphaCard : agent === 'beta' ? this.betaCard : null;
    if (cardEl && this.agentResults[agent]) {
      cardEl.classList.add('cursor-pointer', 'hover:bg-gray-100', 'hover:border-gray-300');
    }
  }

  showModal() {
    this.settingsModal.classList.remove('hidden');
    this.settingsModal.classList.add('flex');

    const savedConfig = this.getSavedConfig();
    const baseUrl = (savedConfig.baseUrl || this.apiUrlInput.value.trim() || 'https://api.openai.com/v1').trim();
    this.apiUrlInput.value = baseUrl;

    const savedModel = this.loadModelForProvider(baseUrl) || savedConfig.model;
    if (savedModel) {
      this.modelInput.value = savedModel;
    }

    const savedApiKey = this.loadApiKeyForProvider(baseUrl);
    this.apiKeyInput.value = savedApiKey || '';

    this.syncPresetToBaseUrl(baseUrl);
    this.refreshOpenRouterModelSection(baseUrl, true);
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
    
    if (!apiKey) {
      alert('Please enter an API key');
      return;
    }
    
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
        
        // Save to localStorage with the API key
        this.saveToLocalStorage(baseUrl, model, apiKey);
      } else {
        const data = await response.json();
        alert('Error: ' + data.error);
      }
    } catch (error) {
      alert('Error saving API config: ' + error.message);
    }
  }
  
  saveToLocalStorage(baseUrl, model, apiKey) {
    const config = this.getSavedConfig();
    
    // Create a unique key for this provider based on baseUrl
    const providerKey = this.getProviderKey(baseUrl);
    
    // Save the API key for this specific provider
    config.apiKeys = config.apiKeys || {};
    config.apiKeys[providerKey] = apiKey;

    // Save model per provider
    config.models = config.models || {};
    config.models[providerKey] = model;
    
    // Save default/baseUrl and model
    config.baseUrl = baseUrl;
    config.model = model;
    
    localStorage.setItem('agent-dashboard-config', JSON.stringify(config));
  }

  getSavedConfig() {
    try {
      const saved = localStorage.getItem('agent-dashboard-config');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  }
  
  getProviderKey(baseUrl) {
    // Extract provider name from URL
    try {
      const url = new URL(baseUrl);
      if (url.hostname.includes('openrouter')) return 'openrouter';
      if (url.hostname.includes('deepseek')) return 'deepseek';
      if (url.hostname.includes('nvidia')) return 'nvidia';
      if (url.hostname.includes('strongwall')) return 'strongwall';
      if (url.hostname.includes('groq')) return 'groq';
      if (url.hostname.includes('ollama')) return 'ollama';
      if (url.hostname.includes('lmstudio')) return 'lmstudio';
      if (url.hostname.includes('openai')) return 'openai';
      return url.hostname;
    } catch (e) {
      return 'custom';
    }
  }
  
  loadApiKeyForProvider(baseUrl) {
    const config = this.getSavedConfig();
    const providerKey = this.getProviderKey(baseUrl);
    if (config.apiKeys && config.apiKeys[providerKey]) {
      return config.apiKeys[providerKey];
    }
    return '';
  }

  loadModelForProvider(baseUrl) {
    const config = this.getSavedConfig();
    const providerKey = this.getProviderKey(baseUrl);
    if (config.models && config.models[providerKey]) {
      return config.models[providerKey];
    }

    // Backward compatibility with older saves that only had one model
    if (config.baseUrl === baseUrl && config.model) {
      return config.model;
    }

    return '';
  }
  
  loadFromLocalStorage() {
    const config = this.getSavedConfig();
    if (!config || !config.baseUrl) {
      return null;
    }

    this.apiUrlInput.value = config.baseUrl;
    this.syncPresetToBaseUrl(config.baseUrl);

    const model = this.loadModelForProvider(config.baseUrl) || config.model;
    if (model) {
      this.modelInput.value = model;
    }

    const apiKey = this.loadApiKeyForProvider(config.baseUrl);
    this.apiKeyInput.value = apiKey || '';

    return config;
  }
  
  async testConnection() {
    const apiKey = this.apiKeyInput.value.trim();
    const baseUrl = this.apiUrlInput.value.trim() || 'https://api.openai.com/v1';
    const model = this.modelInput.value.trim() || 'gpt-4o-mini';
    
    if (!apiKey) {
      alert('Please enter an API key first');
      return;
    }
    
    // Show loading state
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
        alert('✅ Connection successful!\n\nModel: ' + model + '\nResponse: ' + data.response.substring(0, 100) + '...');
      } else {
        alert('❌ Connection failed!\n\nError: ' + data.error);
      }
    } catch (error) {
      alert('❌ Connection failed!\n\nError: ' + error.message);
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

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new AgentDashboard();
});
