import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useOrchestration, useOrchestrationDispatch } from '../context/OrchestrationContext.jsx';
import { ActionTypes, getAgentColor, getAgentIcon, MASTER_COLOR, MASTER_ICON } from '../context/orchestrationReducer.js';
import { renderMarkdown } from '../utils.js';
import AgentIcon from './AgentIcons.jsx';

/* ── Lightning bolt that travels along an edge ── */
function LightningBolt({ x1, y1, x2, y2, id: edgeId }) {
  // Unique id for SVG defs
  const uid = useMemo(() => `bolt-${edgeId}-${Math.random().toString(36).slice(2, 7)}`, [edgeId]);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 1) return null;

  // Build a small zigzag lightning path (5 segments) relative to the line
  const segments = 5;
  const amp = Math.min(8, length * 0.06); // lateral amplitude
  const points = [`M 0 0`];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const along = t * length;
    const lateral = i === segments ? 0 : (i % 2 === 1 ? amp : -amp);
    points.push(`L ${along} ${lateral}`);
  }
  const pathD = points.join(' ');
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <g>
      {/* Glow filter */}
      <defs>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Animated lightning group */}
      <g transform={`translate(${x1},${y1}) rotate(${angle})`}>
        {/* Glow trail */}
        <path
          d={pathD}
          fill="none"
          stroke="#facc15"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.4"
          filter={`url(#${uid}-glow)`}
          className="lightning-bolt-path"
          style={{ '--bolt-length': `${length}px` }}
        />
        {/* Main bolt */}
        <path
          d={pathD}
          fill="none"
          stroke="#eab308"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="lightning-bolt-path"
          style={{ '--bolt-length': `${length}px` }}
        />
        {/* Bright core */}
        <path
          d={pathD}
          fill="none"
          stroke="#fef08a"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="lightning-bolt-path"
          style={{ '--bolt-length': `${length}px` }}
        />
      </g>
    </g>
  );
}

/**
 * Compute hub-and-spoke positions for dynamic agent count.
 * Master is at center. Sub-agents arranged in a circle.
 */
function computePositions(agentCount) {
  const positions = { master: { x: 50, y: 48 } };
  const radius = 36;
  const startAngle = -Math.PI / 2; // top

  for (let i = 0; i < agentCount; i++) {
    const angle = startAngle + (2 * Math.PI * i) / agentCount;
    positions[i] = {
      x: 50 + radius * Math.cos(angle),
      y: 48 + radius * Math.sin(angle),
    };
  }
  return positions;
}

function computeEdges(agentCount) {
  const edges = [];
  for (let i = 0; i < agentCount; i++) {
    edges.push(['master', i]); // master to each agent
  }
  // Connect adjacent agents
  for (let i = 0; i < agentCount; i++) {
    for (let j = i + 1; j < agentCount; j++) {
      if (j === i + 1 || (i === 0 && j === agentCount - 1)) {
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

function AgentNode({ id, agent, position, isSelected, status, onClick, containerSize, isTaskComplete, confidence }) {
  const isMaster = id === 'master';
  const color = isMaster ? MASTER_COLOR : getAgentColor(id);
  const iconKey = isMaster ? MASTER_ICON : getAgentIcon(id);
  const circleSize = isMaster ? 58 : 50;
  const iconSize = isMaster ? 26 : 22;
  // If the overall task is complete, no agent should show as "Working"
  const isWorking = !isTaskComplete && status && (status.includes('Streaming') || status.includes('Working') || status.includes('Analyzing') || status.includes('Processing'));
  const isDone = isTaskComplete || (status && (status.includes('Completed') || status.includes('Complete')));

  const x = (position.x / 100) * containerSize.width;
  const y = (position.y / 100) * containerSize.height;

  return (
    <div
      className={`absolute flex flex-col items-center gap-1.5 cursor-pointer z-[2] agent-node-wrapper ${isSelected ? 'agent-node-selected' : ''}`}
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
      onClick={onClick}
    >
      {/* Node circle — gradient + glass border + colored shadow */}
      <div
        className="agent-node-circle rounded-full flex items-center justify-center text-white relative"
        style={{
          width: circleSize,
          height: circleSize,
          background: `linear-gradient(145deg, ${color.dot}e6, ${color.dot})`,
          boxShadow: isSelected
            ? `0 0 0 3px ${color.dot}30, 0 6px 20px ${color.dot}35`
            : `0 4px 14px ${color.dot}25, inset 0 1px 1px rgba(255,255,255,0.18)`,
        }}
      >
        <AgentIcon iconKey={iconKey} size={iconSize} />

        {/* Spinning ring for working state */}
        {isWorking && (
          <div
            className="absolute inset-[-4px] rounded-full border-[2px] border-transparent animate-spin-ring"
            style={{ borderTopColor: color.dot, borderRightColor: `${color.dot}40` }}
          />
        )}

        {/* Done checkmark — subtle green ring + check */}
        {isDone && (
          <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {/* Label */}
      <div className="text-[11px] font-semibold whitespace-nowrap tracking-tight flex items-center gap-1" style={{ color: color.text }}>
        {agent.name}
        {confidence && (
          <span
            className="text-[9px] font-bold px-1 py-0.5 rounded-full tabular-nums leading-none"
            style={{
              background: confidence.overall >= 7 ? '#dcfce7' : confidence.overall >= 5 ? '#fef9c3' : '#fee2e2',
              color: confidence.overall >= 7 ? '#15803d' : confidence.overall >= 5 ? '#a16207' : '#dc2626',
              border: `1px solid ${confidence.overall >= 7 ? '#86efac' : confidence.overall >= 5 ? '#fde047' : '#fca5a5'}`,
            }}
          >
            {confidence.overall}
          </span>
        )}
      </div>

      {/* Status pill */}
      <div className="agent-node-status">
        {isDone ? (
          <span className="agent-status-pill agent-status-done">Complete</span>
        ) : isWorking ? (
          <span className="agent-status-pill agent-status-working" style={{ color: color.dot, borderColor: `${color.dot}30` }}>
            <span className="agent-status-dot" style={{ background: color.dot }} />
            Working
          </span>
        ) : (
          <span className="agent-status-pill agent-status-idle">{status || 'Stopped'}</span>
        )}
      </div>
    </div>
  );
}

/* ── Reusable topology diagram (used in normal + expanded views) ── */
function TopologyDiagram({ agents, agentCount, agentStatus, selectedAgent, positions, edges, dispatch, activeEdges = [], isTaskComplete = false, agentConfidence = {} }) {
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 400, height: 400 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const getPixelPos = useCallback((id) => {
    const pos = positions[id];
    if (!pos) return { x: 0, y: 0 };
    return {
      x: (pos.x / 100) * containerSize.width,
      y: (pos.y / 100) * containerSize.height,
    };
  }, [positions, containerSize]);

  return (
    <div className="flex-1 relative overflow-hidden" ref={containerRef}>
      {agents.length > 0 ? (
        <>
          <svg className="absolute inset-0 w-full h-full">
            {edges.map(([a, b], i) => {
              const p1 = getPixelPos(a);
              const p2 = getPixelPos(b);
              return (
                <line
                  key={i}
                  x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke="#e5e7eb"
                  strokeWidth="1.5"
                />
              );
            })}
            {/* Lightning bolts for active communication edges */}
            {activeEdges.map((edge) => {
              const p1 = getPixelPos(edge.from);
              const p2 = getPixelPos(edge.to);
              return (
                <LightningBolt
                  key={edge.id}
                  x1={p1.x} y1={p1.y}
                  x2={p2.x} y2={p2.y}
                  id={edge.id}
                />
              );
            })}
          </svg>
          {agents.map((agent) => (
            <AgentNode
              key={agent.id}
              id={agent.id}
              agent={agent}
              position={positions[agent.id] || { x: 50, y: 50 }}
              isSelected={selectedAgent === agent.id}
              status={agentStatus[agent.id === 'master' ? 'master' : agent.id]}
              containerSize={containerSize}
              isTaskComplete={isTaskComplete}
              confidence={agent.id !== 'master' ? agentConfidence[agent.id] : null}
              onClick={() => dispatch({ type: ActionTypes.SELECT_AGENT, agent: agent.id })}
            />
          ))}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          Submit a task to see agent topology
        </div>
      )}
    </div>
  );
}

/* ── Agent streaming / result panel for the expanded view ── */
function AgentStreamPanel({ agentIndex, agentName, streamingContent, result, status }) {
  const color = getAgentColor(agentIndex);
  const iconKey = getAgentIcon(agentIndex);
  const isStreaming = !!streamingContent;
  const content = streamingContent || result || '';
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  const isWorking = status && (status.includes('Streaming') || status.includes('Working') || status.includes('Analyzing') || status.includes('Processing'));
  const isDone = status && (status.includes('Completed') || status.includes('Complete'));

  return (
    <div
      className="topology-agent-panel"
      style={{ borderColor: color.border }}
    >
      {/* Panel header */}
      <div
        className="topology-agent-panel-header"
        style={{ background: color.headerBg, borderColor: color.border }}
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0"
          style={{ background: color.dot }}
        >
          <AgentIcon iconKey={iconKey} size={14} />
        </div>
        <span className="text-xs font-semibold truncate" style={{ color: color.text }}>
          {agentName}
        </span>
        {isStreaming && (
          <span className="flex items-center gap-1 text-[10px] ml-auto shrink-0" style={{ color: color.dot }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color.dot }} />
            Streaming
          </span>
        )}
        {!isStreaming && isDone && (
          <span className="text-[10px] ml-auto text-green-600 shrink-0">✓ Complete</span>
        )}
        {!isStreaming && isWorking && (
          <span className="text-[10px] ml-auto shrink-0" style={{ color: color.dot }}>⚡ Working</span>
        )}
        {!isStreaming && !isDone && !isWorking && status && (
          <span className="text-[10px] ml-auto text-gray-500 shrink-0">{status}</span>
        )}
      </div>

      {/* Panel content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {content ? (
          <>
            <div
              className="md-prose text-[13px] text-gray-800"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
            {isStreaming && <span className="streaming-cursor" />}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-400 italic">
            Waiting for output…
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Split-view icon (columns) ── */
function SplitViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="18" rx="1" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

/* ── Expanded overlay ── */
function ExpandedTopologyOverlay({ agents, agentCount, agentStatus, selectedAgent, positions, edges, dispatch, streamingBuffers, agentResults, activeEdges, isTaskComplete = false, agentConfidence = {}, onClose }) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const subAgents = agents.filter((a) => a.id !== 'master');

  return createPortal(
    <div className="topology-expanded-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="topology-expanded-container animate-fade-slide-in">
        {/* Header */}
        <div className="topology-expanded-header">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">Agent Topology</span>
            <span className="text-[11px] font-medium bg-gray-100 px-2 py-0.5 rounded-full text-gray-500">
              {agentCount + 1} agents
            </span>
          </div>
          <button onClick={onClose} className="topology-expanded-close" title="Close expanded view">
            <CollapseIcon />
          </button>
        </div>

        {/* Content: Topology + Agent Panels */}
        <div className="topology-expanded-content">
          {/* Left: Topology Diagram */}
          <div className="topology-expanded-diagram">
            <div className="px-3 py-2 border-b border-gray-200 text-[11px] font-semibold text-gray-600 shrink-0">
              Network View
            </div>
            <TopologyDiagram
              agents={agents}
              agentCount={agentCount}
              agentStatus={agentStatus}
              selectedAgent={selectedAgent}
              positions={positions}
              edges={edges}
              dispatch={dispatch}
              activeEdges={activeEdges}
              isTaskComplete={isTaskComplete}
              agentConfidence={agentConfidence}
            />
          </div>

          {/* Right: Agent streaming panels */}
          <div className="topology-expanded-panels">
            {subAgents.map((agent) => (
              <AgentStreamPanel
                key={agent.id}
                agentIndex={agent.id}
                agentName={agent.name}
                streamingContent={streamingBuffers[agent.id]}
                result={agentResults[agent.id]}
                status={agentStatus[agent.id]}
              />
            ))}
            {subAgents.length === 0 && (
              <div className="flex items-center justify-center flex-1 text-sm text-gray-400">
                No agents spawned yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Main export ── */
export default function AgentTopology() {
  const { agentNames, agentCount, agentStatus, selectedAgent, streamingBuffers, agentResults, activeEdges, isProcessing, currentTask, agentConfidence } = useOrchestration();
  const dispatch = useOrchestrationDispatch();
  const [expanded, setExpanded] = useState(false);
  const hasTask = Boolean(currentTask);

  // Task is fully complete when master is marked Completed and we're no longer processing
  const isTaskComplete = !isProcessing && !!(agentStatus.master?.includes?.('Completed') || agentStatus.master?.includes?.('Complete'));

  const positions = computePositions(agentCount);
  const edges = computeEdges(agentCount);

  const agents = hasTask
    ? [
        { id: 'master', name: 'Master Agent' },
        ...Array.from({ length: agentCount }, (_, i) => ({
          id: i,
          name: agentNames[i] || `Agent ${i}`,
        })),
      ]
    : [];

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden h-full">
        <div className="px-4 py-3 border-b border-gray-200 text-xs font-semibold flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <span>Agent Topology</span>
            <button
              onClick={() => setExpanded(true)}
              className="topology-expand-btn"
              title="Expand to see all agent streams"
            >
              <SplitViewIcon />
            </button>
          </div>
          <span className="text-[11px] font-medium bg-gray-100 px-2 py-0.5 rounded-full text-gray-500">
            {agents.length} agents
          </span>
        </div>

        <TopologyDiagram
          agents={agents}
          agentCount={agentCount}
          agentStatus={agentStatus}
          selectedAgent={selectedAgent}
          positions={positions}
          edges={edges}
          dispatch={dispatch}
          activeEdges={activeEdges}
          isTaskComplete={isTaskComplete}
          agentConfidence={agentConfidence}
        />
      </div>

      {expanded && (
        <ExpandedTopologyOverlay
          agents={agents}
          agentCount={agentCount}
          agentStatus={agentStatus}
          selectedAgent={selectedAgent}
          positions={positions}
          edges={edges}
          dispatch={dispatch}
          streamingBuffers={streamingBuffers}
          agentResults={agentResults}
          activeEdges={activeEdges}
          isTaskComplete={isTaskComplete}
          agentConfidence={agentConfidence}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
