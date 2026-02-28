import { useOrchestration } from '../context/OrchestrationContext.jsx';

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export default function TokenTracker() {
  const { tokenUsage, isProcessing } = useOrchestration();
  const { totalTokens } = tokenUsage;

  // Don't render if no tokens have been used
  if (totalTokens === 0 && !isProcessing) return null;

  return (
    <div
      className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-gray-400"
      title={`${totalTokens.toLocaleString()} tokens used`}
    >
      {isProcessing && totalTokens > 0 && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-300 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-400" />
        </span>
      )}
      <span>{formatNumber(totalTokens)}</span>
      <span className="text-gray-300">tkns</span>
    </div>
  );
}
