import { useState, useEffect, useCallback } from 'react';
import { useOrchestration } from '../context/OrchestrationContext.jsx';
import { getContextLimit, formatContextLimit } from '../utils/modelContextLimits.js';

// ── Colour map for message role sections ──────────────────────────────────
const SECTION_COLORS = {
  system:      { bg: '#6366f1', label: 'System',         light: '#eef2ff' },
  user:        { bg: '#10b981', label: 'User',           light: '#ecfdf5' },
  assistant:   { bg: '#8b5cf6', label: 'Assistant',      light: '#f5f3ff' },
  tool_result: { bg: '#f59e0b', label: 'Tool / Search',  light: '#fffbeb' },
};

// ── Helpers ───────────────────────────────────────────────────────────────
function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function formatElapsed(ts, startTime) {
  if (!ts || !startTime) return '–';
  const s = Math.floor((ts - startTime) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Resolve agent label (e.g. 'sub-agent-0') → display name + colour
function resolveAgent(agentLabel, agentNames) {
  if (!agentLabel || agentLabel === 'master') {
    return { name: 'Master', color: '#0d9488' };
  }
  if (agentLabel === 'unknown') {
    return { name: 'Unknown', color: '#9ca3af' };
  }
  const m = agentLabel.match(/sub-agent-(\d+)/);
  if (m) {
    const idx = parseInt(m[1], 10);
    const PALETTE = ['#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#6366f1'];
    return { name: agentNames[idx] || `Agent ${idx}`, color: PALETTE[idx % PALETTE.length] };
  }
  return { name: agentLabel, color: '#6b7280' };
}

// ── Sub-components ────────────────────────────────────────────────────────

function MiniBar({ sections, total }) {
  if (!sections?.length || !total) return null;
  return (
    <div className="flex h-2 rounded overflow-hidden w-full gap-px">
      {sections.map((sec) => {
        const pct = (sec.estimatedTokens / total) * 100;
        const col = SECTION_COLORS[sec.role]?.bg ?? '#9ca3af';
        return (
          <div
            key={sec.role}
            title={`${SECTION_COLORS[sec.role]?.label ?? sec.role}: ${sec.estimatedTokens.toLocaleString()} est. tokens`}
            style={{ width: `${pct}%`, backgroundColor: col, minWidth: pct > 1 ? '3px' : undefined }}
          />
        );
      })}
    </div>
  );
}

function ContextBar({ usedTokens, contextLimit }) {
  const pct = Math.min(100, (usedTokens / contextLimit) * 100);
  const barCls = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-indigo-500';
  const txtCls = pct >= 90 ? 'text-red-600' : pct >= 75 ? 'text-amber-600' : 'text-indigo-600';

  return (
    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-gray-500 font-medium">Context window used (latest call)</span>
        <span className={`font-mono font-semibold ${txtCls}`}>
          {formatNumber(usedTokens)}
          <span className="text-gray-400 font-normal"> / {formatContextLimit(contextLimit)}</span>
          <span className="text-gray-400 font-normal ml-1">({pct.toFixed(1)}%)</span>
        </span>
      </div>
      <div className="relative h-2.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${barCls}`} style={{ width: `${pct}%` }} />
        {[50, 75, 90].map((tick) => (
          <div key={tick} className="absolute top-0 bottom-0 w-px bg-white/70" style={{ left: `${tick}%` }} />
        ))}
      </div>
      <div className="flex text-[10px] text-gray-300 mt-0.5" style={{ justifyContent: 'space-between' }}>
        <span>0</span><span style={{ marginLeft: '47%' }}>50%</span>
        <span>75%</span><span>90%</span><span>100%</span>
      </div>
    </div>
  );
}

function SnapshotRow({ snapshot, index, isSelected, onClick, agentNames, startTime }) {
  const { name, color } = resolveAgent(snapshot.agentLabel, agentNames);
  const tokens = snapshot.actualPromptTokens ?? snapshot.totalEstimatedTokens;
  const isEst = snapshot.actualPromptTokens === undefined;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
        isSelected ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {/* Call number */}
        <span className="text-xs font-mono text-gray-400 w-5 text-right shrink-0">#{index + 1}</span>

        {/* Agent badge */}
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {name}
        </span>

        {/* Elapsed time */}
        <span className="text-xs text-gray-400 ml-auto shrink-0">
          {formatElapsed(snapshot.timestamp, startTime)}
        </span>

        {/* Token count */}
        <span className={`text-xs font-mono tabular-nums shrink-0 ${isEst ? 'text-gray-400 italic' : 'text-gray-700 font-semibold'}`}>
          {formatNumber(tokens)}{isEst ? ' ~' : ''} tkns
        </span>
      </div>

      {/* Mini stacked bar */}
      <div className="pl-7 pr-1">
        <MiniBar sections={snapshot.sections} total={snapshot.totalEstimatedTokens} />
      </div>
    </button>
  );
}

function SectionBreakdown({ snapshot }) {
  const total = snapshot.totalEstimatedTokens || 1;
  const [expandedMsgs, setExpandedMsgs] = useState(new Set());
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'content'
  const [roleFilter, setRoleFilter] = useState('all'); // 'all' | specific role

  const toggleMsg = useCallback((idx) => {
    setExpandedMsgs(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!snapshot.messages) return;
    setExpandedMsgs(new Set(snapshot.messages.map(m => m.index)));
  }, [snapshot.messages]);

  const collapseAll = useCallback(() => setExpandedMsgs(new Set()), []);

  const filteredMessages = snapshot.messages
    ? (roleFilter === 'all' ? snapshot.messages : snapshot.messages.filter(m => m.role === roleFilter))
    : [];

  return (
    <div className="px-4 py-3 bg-white">
      {/* Title + view mode toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Call #{snapshot.callId}
          {snapshot.model ? <span className="normal-case font-normal text-gray-400"> · {snapshot.model}</span> : null}
        </div>
        <div className="flex rounded border border-gray-200 overflow-hidden text-xs">
          <button
            onClick={() => setViewMode('table')}
            className={`px-2 py-0.5 transition-colors ${viewMode === 'table' ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('content')}
            className={`px-2 py-0.5 transition-colors ${viewMode === 'content' ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Content
          </button>
        </div>
      </div>

      {/* Full-width stacked bar */}
      <div className="flex h-3 rounded overflow-hidden mb-3 gap-px">
        {snapshot.sections.map((sec) => {
          const pct = (sec.estimatedTokens / total) * 100;
          const col = SECTION_COLORS[sec.role]?.bg ?? '#9ca3af';
          return <div key={sec.role} style={{ width: `${pct}%`, backgroundColor: col, minWidth: '3px' }} />;
        })}
      </div>

      {/* ── Table view ── */}
      {viewMode === 'table' && (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-gray-400 border-b border-gray-100">
              <th className="text-left font-medium py-1.5 pr-2">Section</th>
              <th className="text-right font-medium py-1.5 pr-2">Msgs</th>
              <th className="text-right font-medium py-1.5 pr-2">Chars</th>
              <th className="text-right font-medium py-1.5 pr-2">Est. Tokens</th>
              <th className="text-right font-medium py-1.5">%</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.sections.map((sec) => {
              const col = SECTION_COLORS[sec.role] ?? { bg: '#9ca3af', label: sec.role };
              const pctVal = ((sec.estimatedTokens / total) * 100).toFixed(1);
              return (
                <tr key={sec.role} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
                      <span className="font-medium" style={{ color: col.bg }}>{col.label}</span>
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-gray-600">{sec.messageCount}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-gray-600">{sec.charCount.toLocaleString()}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-gray-700 font-medium">{sec.estimatedTokens.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-500">{pctVal}%</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200">
              <td className="pt-2 pb-1 font-semibold text-gray-700">Total</td>
              <td className="pt-2 pb-1 pr-2 text-right tabular-nums font-medium text-gray-700">
                {snapshot.sections.reduce((s, sec) => s + sec.messageCount, 0)}
              </td>
              <td className="pt-2 pb-1 pr-2 text-right tabular-nums font-medium text-gray-700">
                {snapshot.sections.reduce((s, sec) => s + sec.charCount, 0).toLocaleString()}
              </td>
              <td className="pt-2 pb-1 pr-2 text-right tabular-nums font-bold text-gray-800">
                {snapshot.totalEstimatedTokens.toLocaleString()}
                {snapshot.actualPromptTokens !== undefined && (
                  <div className="text-emerald-600 font-normal text-[10px]">
                    {snapshot.actualPromptTokens.toLocaleString()} actual
                  </div>
                )}
              </td>
              <td className="pt-2 pb-1 text-right text-gray-400">100%</td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* ── Content view ── */}
      {viewMode === 'content' && (
        <div>
          {/* Toolbar: role filter + expand/collapse all */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="flex items-center rounded border border-gray-200 overflow-hidden text-[11px]">
              <button
                onClick={() => setRoleFilter('all')}
                className={`px-1.5 py-0.5 transition-colors ${roleFilter === 'all' ? 'bg-gray-100 text-gray-700 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
              >All</button>
              {Object.entries(SECTION_COLORS).map(([role, col]) => (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={`px-1.5 py-0.5 transition-colors ${roleFilter === role ? 'font-medium' : 'hover:opacity-80'}`}
                  style={roleFilter === role ? { backgroundColor: `${col.bg}18`, color: col.bg } : { color: '#9ca3af' }}
                >{col.label}</button>
              ))}
            </div>
            <div className="ml-auto flex gap-1 text-[10px]">
              <button onClick={expandAll}  className="px-1.5 py-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">Expand all</button>
              <button onClick={collapseAll} className="px-1.5 py-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">Collapse all</button>
            </div>
          </div>

          {/* Message list */}
          {filteredMessages.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No messages to display</p>
          )}

          <div className="space-y-1">
            {filteredMessages.map((msg) => {
              const col = SECTION_COLORS[msg.role] ?? { bg: '#9ca3af', label: msg.role, light: '#f3f4f6' };
              const isOpen = expandedMsgs.has(msg.index);
              return (
                <div key={msg.index} className="rounded-md border overflow-hidden" style={{ borderColor: `${col.bg}30` }}>
                  {/* Collapsible header */}
                  <button
                    onClick={() => toggleMsg(msg.index)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors hover:brightness-95"
                    style={{ backgroundColor: col.light }}
                  >
                    {/* Expand/collapse chevron */}
                    <svg
                      className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      style={{ color: col.bg }}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>

                    {/* Role badge */}
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
                    <span className="font-semibold shrink-0" style={{ color: col.bg }}>{col.label}</span>

                    {/* Message index */}
                    <span className="text-gray-400 font-mono text-[10px]">#{msg.index + 1}</span>

                    {/* Stats */}
                    <span className="ml-auto text-[10px] font-mono tabular-nums text-gray-400">
                      {msg.charCount.toLocaleString()} chars · ~{msg.estimatedTokens.toLocaleString()} tkns
                    </span>
                  </button>

                  {/* Content body */}
                  {isOpen && (
                    <div
                      className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words select-text bg-white border-t max-h-[400px] overflow-y-auto"
                      style={{ borderColor: `${col.bg}20`, color: '#374151', lineHeight: '1.6' }}
                    >
                      {msg.content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

/**
 * Shared inspector body — used in both the slide-over drawer and the docked
 * panel tab.  Renders the context bar, legend, call list and detail pane.
 */
export function InspectorBody() {
  const { contextSnapshots, agentNames, currentConfig, startTime } = useOrchestration();
  const [selectedIdx, setSelectedIdx] = useState(null);

  // Auto-select the newest call as it arrives
  useEffect(() => {
    if (contextSnapshots.length > 0) {
      setSelectedIdx(contextSnapshots.length - 1);
    }
  }, [contextSnapshots.length]);

  const contextLimit = getContextLimit(currentConfig?.model);
  const latestSnapshot = contextSnapshots.length > 0 ? contextSnapshots[contextSnapshots.length - 1] : null;
  const selectedSnapshot = selectedIdx !== null ? contextSnapshots[selectedIdx] ?? null : null;

  if (contextSnapshots.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 p-10 text-center">
        <svg className="w-12 h-12 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-sm font-medium text-gray-500">No LLM calls yet</p>
        <p className="text-xs text-gray-400 max-w-[200px]">
          Submit a task to see context window snapshots appear here in real-time.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Context bar (latest call) */}
      {latestSnapshot && (
        <ContextBar usedTokens={latestSnapshot.totalEstimatedTokens} contextLimit={contextLimit} />
      )}

      {/* Role legend */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50 shrink-0">
        {Object.entries(SECTION_COLORS).map(([role, col]) => (
          <span key={role} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: col.bg }} />
            {col.label}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-gray-400">~ = est.  ·  click for detail</span>
      </div>

      {/* Scrollable call list + detail panel */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Call list */}
        <div
          className="overflow-y-auto"
          style={{ flex: selectedSnapshot ? '0 0 auto' : '1 1 auto', maxHeight: selectedSnapshot ? '45%' : '100%' }}
        >
          {[...contextSnapshots].reverse().map((snap, ri) => {
            const origIdx = contextSnapshots.length - 1 - ri;
            return (
              <SnapshotRow
                key={snap.callId}
                snapshot={snap}
                index={origIdx}
                isSelected={selectedIdx === origIdx}
                onClick={() => setSelectedIdx(selectedIdx === origIdx ? null : origIdx)}
                agentNames={agentNames}
                startTime={startTime}
              />
            );
          })}
        </div>

        {/* Section breakdown */}
        {selectedSnapshot && (
          <div className="overflow-y-auto border-t-2 border-indigo-100 flex-1" style={{ minHeight: '220px' }}>
            <SectionBreakdown snapshot={selectedSnapshot} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Drawer version — the slide-over overlay used when the inspector is NOT docked.
 * Props:
 *   open      – whether the drawer is visible
 *   onClose   – close the drawer
 *   onDock    – move the inspector into the right-panel tab
 */
export default function ContextWindowInspector({ open, onClose, onDock }) {
  const { contextSnapshots } = useOrchestration();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Semi-transparent backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} aria-hidden="true" />

      {/* Slide-over drawer */}
      <aside className="fixed inset-y-0 right-0 w-[460px] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200 overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
          <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-sm font-semibold text-gray-800 flex-1">Context Window Inspector</span>
          {contextSnapshots.length > 0 && (
            <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-1.5 py-0.5 rounded-full">
              {contextSnapshots.length} call{contextSnapshots.length !== 1 ? 's' : ''}
            </span>
          )}
          {/* Dock to right-panel button */}
          {onDock && (
            <button
              onClick={onDock}
              className="p-1 rounded-md hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
              title="Dock to right panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 5l7 7-7 7M5 12h14" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Close (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Shared body */}
        <InspectorBody />
      </aside>
    </>
  );
}
