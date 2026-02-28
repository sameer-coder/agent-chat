import { useOrchestration } from '../context/OrchestrationContext.jsx';
import { getAgentColor, getAgentIcon, MASTER_COLOR, MASTER_ICON } from '../context/orchestrationReducer.js';
import { renderMarkdown } from '../utils.js';
import AgentIcon from './AgentIcons.jsx';

export default function ProgressSidebar({ embedded = false }) {
  const { subtasks, agentNames, selectedAgent, agentStatus, agentResults, messages, streamingBuffers } = useOrchestration();

  const content = (
    <>
      {!embedded && (
        <div className="px-4 py-3 border-b border-gray-200 text-xs font-semibold shrink-0">
          Progress &amp; Details
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
        {/* Task Breakdown */}
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Task Breakdown
          </div>
          {subtasks.length === 0 ? (
            <div className="text-xs text-gray-400">No tasks yet</div>
          ) : (
            <div className="space-y-1">
              {subtasks.map((st) => {
                const color = getAgentColor(st.agentIndex);
                const name = agentNames[st.agentIndex] || `Agent ${st.agentIndex}`;
                return (
                  <div key={st.agentIndex} className="flex items-start gap-2 py-1.5 text-xs">
                    <TaskCheckmark status={st.status} />
                    <div>
                      <div className="leading-snug">{st.task}</div>
                      <div className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: color.dot }}>
                        <AgentIcon iconKey={getAgentIcon(st.agentIndex)} size={12} /> {name}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Agent Details */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Agent Details
          </div>
          {selectedAgent === null ? (
            <div className="text-xs text-gray-400 text-center py-4">Click an agent to see details</div>
          ) : (
            <AgentDetail
              agentId={selectedAgent}
              agentNames={agentNames}
              agentStatus={agentStatus}
              agentResults={agentResults}
              messages={messages}
              streamingBuffers={streamingBuffers}
            />
          )}
        </div>
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex flex-col h-full overflow-hidden">{content}</div>;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden h-full">
      {content}
    </div>
  );
}

function TaskCheckmark({ status }) {
  if (status === 'done') {
    return (
      <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white mt-0.5 shrink-0">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className="w-4 h-4 rounded-full border-2 border-indigo-500 bg-indigo-50 flex items-center justify-center mt-0.5 shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
      </div>
    );
  }
  return (
    <div className="w-4 h-4 rounded-full border-2 border-gray-200 mt-0.5 shrink-0" />
  );
}

function AgentDetail({ agentId, agentNames, agentStatus, agentResults, messages, streamingBuffers }) {
  const isMaster = agentId === 'master';
  const name = isMaster ? 'Master Agent' : (agentNames[agentId] || `Agent ${agentId}`);
  const color = isMaster ? MASTER_COLOR : getAgentColor(agentId);
  const iconKey = isMaster ? MASTER_ICON : getAgentIcon(agentId);
  const status = isMaster ? (agentStatus.master || 'Idle') : (agentStatus[agentId] || 'Idle');

  // Count messages related to this agent
  const agentMessages = messages.filter((msg) => {
    if (isMaster) {
      return msg.agent === 'master-handler' || msg.type === 'evaluation' || msg.type === 'complete';
    }
    return msg.agentIndex === agentId || msg.from === agentId || msg.to === agentId;
  });

  // Collect thinking/status messages as "thoughts"
  const thoughts = messages.filter((msg) => {
    if (isMaster) return msg.type === 'status' && msg.agent === 'master-handler';
    return msg.type === 'status' && msg.agentIndex === agentId;
  });

  const result = !isMaster ? agentResults[agentId] : null;
  const streamingContent = !isMaster ? streamingBuffers[agentId] : null;

  return (
    <div className="bg-gray-50 rounded-lg p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: color.dot }}>
          <AgentIcon iconKey={iconKey} size={16} />
        </div>
        <div>
          <div className="text-[13px] font-semibold">{name}</div>
          <div className="text-[11px] text-gray-500">{status}</div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-white rounded-md p-2 text-center">
          <div className="text-lg font-bold" style={{ color: color.dot }}>{agentMessages.length}</div>
          <div className="text-[10px] text-gray-500">Messages</div>
        </div>
        <div className="bg-white rounded-md p-2 text-center">
          <div className="text-lg font-bold" style={{ color: color.dot }}>{thoughts.length}</div>
          <div className="text-[10px] text-gray-500">Thoughts</div>
        </div>
      </div>

      {/* Thought Log */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Thought Log</div>
      <div className="max-h-40 overflow-y-auto custom-scrollbar">
        {thoughts.length === 0 ? (
          <div className="text-[11px] text-gray-400">No thoughts recorded yet</div>
        ) : (
          thoughts.map((t) => (
            <div key={t.id} className="text-[11px] py-1 border-b border-gray-200 last:border-0 leading-snug">
              <span className="text-gray-400 mr-1">{t.timeLabel}</span>
              {t.text}
            </div>
          ))
        )}
      </div>

      {/* Streaming content */}
      {streamingContent && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1.5">
            Live Output
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color.dot }} />
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar bg-white rounded-md p-2">
            <div
              className="md-prose text-[11px] text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }}
            />
            <span className="streaming-cursor" />
          </div>
        </div>
      )}

      {/* Result preview */}
      {result && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Result</div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar bg-white rounded-md p-2">
            <div
              className="md-prose text-[11px] text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
            />
          </div>
        </div>
      )}
    </div>
  );
}