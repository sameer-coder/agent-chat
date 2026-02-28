import { useOrchestration } from '../context/OrchestrationContext.jsx';
import { extractProviderName } from '../utils.js';
import TokenTracker from './TokenTracker.jsx';

export default function Header({ onOpenSettings, onOpenInspector }) {
  const { isConnected, apiConfigured, currentConfig, isProcessing, currentTask, progress } = useOrchestration();

  const providerLabel = apiConfigured
    ? (() => {
        const provider = extractProviderName(currentConfig.baseUrl);
        const model = currentConfig.model || 'Unknown';
        return provider ? `${provider} · ${model}` : `API: ${model}`;
      })()
    : 'API Not Configured';

  return (
    <header className="bg-white border-b border-gray-200 flex items-center px-5 gap-4 h-14 shadow-sm z-10 shrink-0">
      {/* Logo */}
      <h1 className="text-base font-semibold whitespace-nowrap flex items-center gap-2">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Pentagon outline connecting the 5 satellite agents — subtle ring */}
          <polygon
            points="12,4 19.6,9.5 16.7,18.5 7.3,18.5 4.4,9.5"
            fill="none"
            stroke="#bae6fd"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          {/* Spokes from center hub to each satellite */}
          <line x1="12" y1="12" x2="12"   y2="4"    stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="12" y1="12" x2="19.6" y2="9.5"  stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="12" y1="12" x2="16.7" y2="18.5" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="12" y1="12" x2="7.3"  y2="18.5" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="12" y1="12" x2="4.4"  y2="9.5"  stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />
          {/* 5 satellite agent nodes */}
          <circle cx="12"   cy="4"    r="1.8" fill="#0ea5e9" />
          <circle cx="19.6" cy="9.5"  r="1.8" fill="#0ea5e9" />
          <circle cx="16.7" cy="18.5" r="1.8" fill="#0ea5e9" />
          <circle cx="7.3"  cy="18.5" r="1.8" fill="#0ea5e9" />
          <circle cx="4.4"  cy="9.5"  r="1.8" fill="#0ea5e9" />
          {/* Center orchestrator hub */}
          <circle cx="12" cy="12" r="2.8" fill="#0284c7" />
        </svg>
        <span>Multi Agent Deep Research</span>
      </h1>

      {/* Task title */}
      {currentTask && (
        <div className="flex-1 text-xs text-gray-500 overflow-hidden text-ellipsis whitespace-nowrap">
          Task: <span className="text-gray-800 font-medium">{currentTask}</span>
        </div>
      )}
      {!currentTask && <div className="flex-1" />}

      {/* Progress bar */}
      {isProcessing && (
        <div className="flex items-center gap-2 text-xs font-semibold whitespace-nowrap">
          <span>{progress}%</span>
          <div className="w-28 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-400"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Token / Cost Tracker */}
      <TokenTracker onClick={onOpenInspector} />

      {/* Context Window Inspector button — always visible */}
      <button
        onClick={onOpenInspector}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-500 px-1.5 py-1 rounded hover:bg-indigo-50 transition-colors"
        title="Context Window Inspector"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <span className="hidden sm:inline">Inspect</span>
      </button>

      {/* Status indicators */}
      <div className="flex items-center gap-3">
        {/* Connection status */}
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* API status */}
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className={`w-2 h-2 rounded-full ${apiConfigured ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>{providerLabel}</span>
        </div>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
          title="Configure API"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
