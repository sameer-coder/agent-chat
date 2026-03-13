import { useRef, useEffect, useMemo, useState } from 'react';
import { useOrchestration, useOrchestrationDispatch } from '../context/OrchestrationContext.jsx';
import { ActionTypes, getAgentColor, MASTER_COLOR } from '../context/orchestrationReducer.js';
import { renderMarkdown } from '../utils.js';
import StreamingMessage from './messages/StreamingMessage.jsx';

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'message', label: 'Messages' },
  { key: 'result', label: 'Results' },
];

const THINKING_TYPES = new Set(['status']);
const MESSAGE_TYPES = new Set(['agent-communication', 'agent-question', 'agent-answer', 'follow-up', 'retry', 'warning']);
const RESULT_TYPES = new Set(['agent-result', 'evaluation', 'complete', 'self-critique', 'self-critique-revised']);

function filterMessages(messages, filter) {
  if (filter === 'all') return messages;
  return messages.filter((msg) => {
    if (filter === 'thinking') return THINKING_TYPES.has(msg.type);
    if (filter === 'message') return MESSAGE_TYPES.has(msg.type) || msg.type === 'task-breakdown';
    if (filter === 'result') return RESULT_TYPES.has(msg.type);
    return true;
  });
}

export default function ConversationFeed() {
  const { messages, feedFilter, agentNames, streamingBuffers } = useOrchestration();
  const dispatch = useOrchestrationDispatch();
  const scrollRef = useRef(null);

  const filtered = useMemo(() => filterMessages(messages, feedFilter), [messages, feedFilter]);
  const streamingAgents = Object.keys(streamingBuffers).map(Number);
  const isNearBottom = useRef(true);

  // Track whether user is near the bottom of the scroll container
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 80;
      isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll only when user is already near the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottom.current) el.scrollTop = el.scrollHeight;
  }, [filtered.length, streamingBuffers]);

  const totalMessages = messages.length + streamingAgents.length;

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 text-xs font-semibold flex items-center justify-between shrink-0">
        <span>Live Conversation</span>
        <span className="text-[11px] font-medium bg-gray-100 px-2 py-0.5 rounded-full text-gray-500">
          {totalMessages} messages
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex gap-1 px-4 py-2 border-b border-gray-200 shrink-0 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => dispatch({ type: ActionTypes.SET_FEED_FILTER, filter: tab.key })}
            className={`text-[10px] px-2 py-1 rounded font-medium border transition-all ${
              feedFilter === tab.key
                ? 'bg-indigo-500 text-white border-indigo-500'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar space-y-1">
        {filtered.map((msg) => (
          <FeedEntry key={msg.id} msg={msg} agentNames={agentNames} />
        ))}

        {/* Active streaming messages */}
        {streamingAgents.map((idx) => (
          <StreamingMessage
            key={`stream-${idx}`}
            agentIndex={idx}
            agentName={agentNames[idx] || `Agent ${idx}`}
            content={streamingBuffers[idx]}
          />
        ))}

        {/* Empty state */}
        {filtered.length === 0 && streamingAgents.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            No messages yet
          </div>
        )}
      </div>
    </>
  );
}

/** Parse a string agent ID like "sub-agent-0" to its numeric index, or return -1. */
function parseAgentIndex(id) {
  if (typeof id === 'number') return id;
  const s = String(id).toLowerCase();
  if (s === 'alpha' || s === 'sub-agent-alpha') return 0;
  if (s === 'beta' || s === 'sub-agent-beta') return 1;
  const m = s.match(/sub-agent-(\d+)/);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0) return n;
  return -1;
}

function FeedEntry({ msg, agentNames }) {
  const getAgentName = (agentIndexOrId) => {
    if (agentIndexOrId === 'master-handler' || agentIndexOrId === 'master') return 'Master Agent';
    if (agentIndexOrId === 'system') return 'System';
    const idx = parseAgentIndex(agentIndexOrId);
    if (idx >= 0) {
      return agentNames[idx] || `Agent ${idx}`;
    }
    return String(agentIndexOrId);
  };

  const getColor = (agentIndex) => {
    if (agentIndex === 'master-handler' || agentIndex === 'master' || agentIndex === 'system') return MASTER_COLOR;
    const idx = parseAgentIndex(agentIndex);
    if (idx >= 0) return getAgentColor(idx);
    return MASTER_COLOR;
  };

  switch (msg.type) {
    case 'user':
      return <UserEntry text={msg.text} time={msg.timeLabel} />;
    case 'task-received':
      return <BannerEntry text={msg.text} />;
    case 'agent-spawned':
      return <BannerEntry text={msg.text} icon={msg.icon} />;
    case 'status':
      return <StatusEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'task-breakdown':
      return <TaskBreakdownEntry msg={msg} agentNames={agentNames} />;
    case 'agent-result':
      return <AgentResultEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'evaluation':
      return <EvaluationEntry msg={msg} />;
    case 'follow-up':
      return <FollowUpEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'agent-communication':
      return <CommunicationEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'agent-question':
      return <QuestionEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'agent-answer':
      return <AnswerEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'self-critique':
      return <SelfCritiqueEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'self-critique-revised':
      return <SelfCritiqueRevisedEntry msg={msg} getName={getAgentName} getColor={getColor} />;
    case 'retry':
      return <RetryEntry msg={msg} getName={getAgentName} />;
    case 'warning':
      return <WarningEntry msg={msg} getName={getAgentName} />;
    case 'complete':
      return <CompleteEntry msg={msg} />;
    case 'stopped':
      return <StoppedEntry time={msg.timeLabel} />;
    case 'error':
      return <ErrorEntry msg={msg} />;
    default:
      return null;
  }
}

// ── Individual entry components ──

function BannerEntry({ text, icon }) {
  return (
    <div className="flex justify-center py-1.5 animate-fade-slide-in">
      <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-100 border border-gray-200 rounded-full text-[13px] text-gray-500 font-medium">
        {icon && <span>{icon}</span>}
        {text}
      </div>
    </div>
  );
}

function UserEntry({ text, time }) {
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{time}</div>
      <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[13px] shrink-0">👤</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-gray-700">You</div>
        <div className="text-[13px] text-gray-800 mt-0.5">{text}</div>
      </div>
    </div>
  );
}

function StatusEntry({ msg, getName, getColor }) {
  const agent = msg.agent || msg.agentIndex;
  const name = getName(agent);
  const color = getColor(typeof msg.agentIndex === 'number' ? msg.agentIndex : agent);

  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-500 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] text-white shrink-0"
        style={{ background: color.dot }}>
        ⚡
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1.5">
          <span style={{ color: color.dot }}>{name}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-wider">thinking</span>
        </div>
        <div className="text-[13px] text-gray-600 mt-0.5 italic">{msg.text}</div>
      </div>
    </div>
  );
}

function TaskBreakdownEntry({ msg, agentNames }) {
  return (
    <div className="py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="flex gap-2.5">
        <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
        <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-[13px] text-white shrink-0">📋</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-purple-700">Task Breakdown ({msg.subtasks.length} agents)</div>
          <div className="text-[13px] text-gray-600 mt-1">{msg.explanation}</div>
          <div className="mt-2 space-y-1">
            {msg.subtasks.map((task, i) => {
              const color = getAgentColor(i);
              const name = agentNames[i] || `Agent ${i}`;
              return (
                <div key={i} className="flex items-start gap-1.5 text-[13px] p-1.5 rounded" style={{ background: color.bg, border: `1px solid ${color.border}` }}>
                  <span className="font-medium shrink-0" style={{ color: color.text }}>{name}:</span>
                  <span className="text-gray-700">{task}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentResultEntry({ msg, getName, getColor }) {
  const color = getColor(msg.agentIndex);
  const name = getName(msg.agentIndex);
  const roundLabel = msg.round > 1 ? ` (Follow-up Round ${msg.round - 1})` : '';
  const isLong = (msg.text || '').length > 300;
  const [expanded, setExpanded] = useState(!isLong);

  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] text-white shrink-0" style={{ background: color.dot }}>
        📄
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1">
          <span style={{ color: color.dot }}>{name}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-600 uppercase tracking-wider">result</span>
          {roundLabel && <span className="text-[11px] text-gray-400">{roundLabel}</span>}
          {isLong && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="ml-auto flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-all cursor-pointer select-none"
              title={expanded ? 'Collapse result' : 'Expand result'}
            >
              <span
                className="inline-block transition-transform duration-200"
                style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
              >
                ▾
              </span>
              {expanded ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        {expanded ? (
          <div
            className="md-prose text-[13px] text-gray-800 mt-1"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text || '') }}
          />
        ) : (
          <div className="text-[11px] text-gray-400 mt-1 italic">
            Result collapsed — {(msg.text || '').length.toLocaleString()} chars
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationEntry({ msg }) {
  const satisfied = msg.satisfied;
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] text-white shrink-0 ${satisfied ? 'bg-green-500' : 'bg-orange-500'}`}>
        {satisfied ? '✓' : '⚠'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1">
          <span className="text-gray-700">Master Agent — Evaluation</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider ${satisfied ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
            {satisfied ? 'Satisfied' : 'Needs Follow-up'}
          </span>
          <span className="text-[11px] text-gray-400">Round {msg.round}</span>
        </div>
        <div className="text-[13px] text-gray-600 mt-1">{msg.text}</div>
      </div>
    </div>
  );
}

function FollowUpEntry({ msg, getName, getColor }) {
  const color = getColor(msg.agentIndex);
  const name = getName(msg.agentIndex);
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] text-white shrink-0" style={{ background: color.dot }}>🔄</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">
          <span className="text-gray-600">Follow-up assigned to </span>
          <span style={{ color: color.dot }}>{name}</span>
          <span className="text-[11px] text-gray-400 ml-1">Round {msg.round}</span>
        </div>
        <div className="text-[13px] text-gray-600 mt-1">{msg.text}</div>
      </div>
    </div>
  );
}

function CommunicationEntry({ msg, getName, getColor }) {
  const fromColor = getColor(msg.from);
  const fromName = getName(msg.from);
  const toName = getName(msg.to);
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] text-white shrink-0" style={{ background: fromColor.dot }}>💬</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1">
          <span style={{ color: fromColor.dot }}>{fromName}</span>
          <span className="text-gray-400">→</span>
          <span className="text-gray-600">{toName}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 uppercase tracking-wider">message</span>
        </div>
        <div className="text-[13px] text-gray-700 mt-1">{msg.text}</div>
      </div>
    </div>
  );
}

function QuestionEntry({ msg, getName, getColor }) {
  const fromColor = getColor(msg.from);
  const fromName = getName(msg.from);
  const toName = getName(msg.to);
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-[13px] text-white shrink-0">❓</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1">
          <span style={{ color: fromColor.dot }}>{fromName}</span>
          <span className="text-gray-400">→</span>
          <span className="text-gray-600">{toName}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 uppercase tracking-wider">question</span>
        </div>
        <div className="text-[13px] text-gray-700 mt-1 italic">{msg.text}</div>
      </div>
    </div>
  );
}

function AnswerEntry({ msg, getName, getColor }) {
  const fromColor = getColor(msg.from);
  const fromName = getName(msg.from);
  const toName = getName(msg.to);
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-[13px] text-white shrink-0">✅</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1">
          <span style={{ color: fromColor.dot }}>{fromName}</span>
          <span className="text-gray-400">→</span>
          <span className="text-gray-600">{toName}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 uppercase tracking-wider">answer</span>
        </div>
        <div className="text-[13px] text-gray-700 mt-1">{msg.text}</div>
      </div>
    </div>
  );
}

function RetryEntry({ msg, getName }) {
  const displayName = msg.agent === 'master-handler' ? 'Master Agent' : getName(msg.agentIndex);
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-[13px] text-white shrink-0 animate-spin-ring">🔄</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-amber-700">{displayName} <span className="text-[13px] text-amber-600 font-normal">Retry {msg.attempt}/{msg.maxRetries}</span></div>
        <div className="text-[13px] text-gray-600 mt-0.5">{msg.text}</div>
      </div>
    </div>
  );
}

function WarningEntry({ msg, getName }) {
  const displayName = msg.agent === 'master-handler' ? 'Master Agent' : getName(msg.agentIndex);
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full bg-yellow-500 flex items-center justify-center text-[13px] text-white shrink-0">⚠️</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-yellow-700">Warning from {displayName}</div>
        <div className="text-[13px] text-gray-600 mt-0.5">{msg.text}</div>
      </div>
    </div>
  );
}

function CompleteEntry({ msg }) {
  return (
    <div className="py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="flex gap-2.5">
        <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
        <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-xs text-white shrink-0">🎯</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold flex items-center gap-1">
            <span className="text-purple-700">Final Synthesis</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-600 uppercase tracking-wider">result</span>
          </div>
          <div
            className="md-prose text-[13px] text-gray-800 mt-1"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
          />
        </div>
      </div>
    </div>
  );
}

function StoppedEntry() {
  return (
    <div className="flex justify-center py-2 animate-fade-slide-in">
      <div className="flex items-center gap-1.5 px-3 py-1 bg-orange-50 border border-orange-200 rounded-full text-[13px] text-orange-700">
        ⏹ Processing stopped by user.
      </div>
    </div>
  );
}

function ErrorEntry({ msg }) {
  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full bg-red-500 flex items-center justify-center text-[13px] text-white shrink-0">✕</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-red-600">Error</div>
        <div className="text-[13px] text-gray-700 mt-0.5">{msg.text}</div>
      </div>
    </div>
  );
}

// ── Self-Critique Scorecard Components ─────────────────────────────────────

function ScoreBar({ score }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(score * 10), 80);
    return () => clearTimeout(t);
  }, [score]);
  const barColor = score >= 7 ? '#6ee7b7' : score >= 5 ? '#fcd34d' : '#fca5a5';
  return (
    <div className="score-bar-track flex-1">
      <div
        className="score-bar-fill"
        style={{ width: `${width}%`, backgroundColor: barColor }}
      />
    </div>
  );
}

function ScoreLabel({ score }) {
  const color = score >= 7 ? '#059669' : score >= 5 ? '#d97706' : '#dc2626';
  return (
    <span className="text-[11px] font-semibold tabular-nums w-8 text-right" style={{ color }}>
      {score}/10
    </span>
  );
}

function SelfCritiqueEntry({ msg, getName, getColor }) {
  const { agentIndex, scores, overall, critique, willRevise, timeLabel } = msg;
  const name = getName(agentIndex);
  const color = getColor(agentIndex);
  const overallColor = overall >= 7 ? '#059669' : overall >= 5 ? '#d97706' : '#dc2626';

  return (
    <div className="py-1.5 animate-fade-slide-in">
      <div className={`rounded-lg border overflow-hidden ${willRevise ? 'bg-red-50/50 border-red-200' : 'bg-blue-50/30 border-blue-200/60'}`}>
        {/* Header */}
        <div className={`px-3 py-2 flex items-center justify-between border-b ${willRevise ? 'bg-red-50 border-red-200' : 'bg-blue-50/50 border-blue-200/60'}`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color.dot }} />
            <span className="text-[12px] font-semibold text-gray-800">{name}</span>
            <span className="text-[10px] text-gray-500">· Self-Assessment</span>
          </div>
          <div className="flex items-center gap-2">
            {willRevise ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600 border border-red-200">
                ↻ Revising
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
                ✓ Confident
              </span>
            )}
            <span className="text-[10px] text-gray-500 tabular-nums">{timeLabel}</span>
          </div>
        </div>

        {/* Score bars */}
        <div className="px-3 pt-2.5 pb-1.5 space-y-2">
          {[
            { label: 'Accuracy', score: scores.accuracy },
            { label: 'Completeness', score: scores.completeness },
            { label: 'Relevance', score: scores.relevance },
          ].map(({ label, score }) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="text-[11px] text-gray-600 w-24 shrink-0">{label}</span>
              <ScoreBar score={score} />
              <ScoreLabel score={score} />
            </div>
          ))}
        </div>

        {/* Footer: overall + critique */}
        <div className={`px-3 pb-2.5 pt-2 flex items-start gap-3 border-t mt-1 ${willRevise ? 'border-red-100' : 'border-blue-100'}`}>
          <div className="flex items-baseline gap-1 shrink-0">
            <span className="text-[11px] text-gray-500">Overall</span>
            <span className="text-[16px] font-bold" style={{ color: overallColor }}>{overall}</span>
            <span className="text-[10px] text-gray-500">/10</span>
          </div>
          {critique && (
            <div className="critique-quote text-[11px] text-gray-500 italic leading-relaxed">
              "{critique}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SelfCritiqueRevisedEntry({ msg, getName, getColor }) {
  const { agentIndex, scores, overall, originalScores, originalOverall } = msg;
  const name = getName(agentIndex);
  const color = getColor(agentIndex);
  const delta = +(overall - originalOverall).toFixed(1);

  return (
    <div className="py-1.5 animate-fade-slide-in">
      <div className="rounded-lg border border-emerald-200 overflow-hidden bg-emerald-50/40">
        {/* Header */}
        <div className="px-3 py-2 flex items-center justify-between bg-emerald-50 border-b border-emerald-200">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color.dot }} />
            <span className="text-[12px] font-semibold text-gray-800">{name}</span>
            <span className="text-[10px] text-gray-500">· Revised Assessment</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
            +{delta} improvement
          </span>
        </div>

        {/* Before / After comparison rows */}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-gray-400 w-24 shrink-0" />
            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide w-8 text-center">Before</span>
            <span className="text-[10px] text-gray-400 w-4 text-center">→</span>
            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide w-8 text-center">After</span>
          </div>
          {[
            { label: 'Accuracy', before: originalScores.accuracy, after: scores.accuracy },
            { label: 'Completeness', before: originalScores.completeness, after: scores.completeness },
            { label: 'Relevance', before: originalScores.relevance, after: scores.relevance },
          ].map(({ label, before, after }) => {
            const improved = after > before;
            return (
              <div key={label} className="flex items-center gap-2 py-0.5">
                <span className="text-[11px] text-gray-600 w-24 shrink-0">{label}</span>
                <span className="text-[12px] font-bold tabular-nums text-gray-500 w-8 text-center">{before}</span>
                <span className="text-[10px] text-gray-400 w-4 text-center">→</span>
                <span className={`text-[12px] font-bold tabular-nums w-8 text-center ${improved ? 'text-emerald-600' : 'text-gray-500'}`}>{after}</span>
                {improved && (
                  <span className="text-[10px] text-emerald-500 font-medium">↑{after - before}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Overall comparison */}
        <div className="px-3 pb-2.5 pt-1 flex items-center gap-2 border-t border-emerald-100">
          <span className="text-[11px] text-gray-500">Overall</span>
          <span className="text-[13px] font-bold text-gray-500 tabular-nums">{originalOverall}</span>
          <span className="text-[11px] text-gray-400">→</span>
          <span className="text-[15px] font-bold text-emerald-600 tabular-nums">{overall}</span>
          <span className="text-[10px] text-emerald-600 font-medium ml-1">✓ Quality improved</span>
        </div>
      </div>
    </div>
  );
}
