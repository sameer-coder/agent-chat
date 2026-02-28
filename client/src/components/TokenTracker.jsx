import { useOrchestration } from '../context/OrchestrationContext.jsx';

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export default function TokenTracker({ onClick }) {
  const { tokenUsage, isProcessing } = useOrchestration();
  const { totalTokens } = tokenUsage;

  // Don't render if no tokens have been used
  if (totalTokens === 0 && !isProcessing) return null;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-gray-400 hover:text-indigo-500 transition-colors rounded px-1.5 py-1 hover:bg-indigo-50 cursor-pointer group"
      title="Open Context Window Inspector"
    >
      {isProcessing && totalTokens > 0 && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-300 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-400" />
        </span>
      )}
      <span>{formatNumber(totalTokens)}</span>
      <span className="text-gray-300 group-hover:text-indigo-300">tkns</span>
      {/* Inspector icon — appears on hover */}
      <svg
        className="w-3 h-3 text-gray-300 group-hover:text-indigo-400 transition-colors"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    </button>
  );
}
