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
const RESULT_TYPES = new Set(['agent-result', 'evaluation', 'complete']);

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
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">{msg.timeLabel}</div>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] text-white shrink-0"
        style={{ background: color.dot }}>
        ⚡
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1">
          <span style={{ color: color.dot }}>{name}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 uppercase tracking-wider">thinking</span>
        </div>
        <div className="text-[13px] text-gray-500 mt-0.5 italic">{msg.text}</div>
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
