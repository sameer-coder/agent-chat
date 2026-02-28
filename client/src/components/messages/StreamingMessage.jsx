import { useState, useRef, useEffect } from 'react';
import { getAgentColor } from '../../context/orchestrationReducer.js';
import { renderMarkdown } from '../../utils.js';

export default function StreamingMessage({ agentIndex, agentName, content }) {
  const color = getAgentColor(agentIndex);
  const [collapsed, setCollapsed] = useState(false);
  const contentRef = useRef(null);

  // Count lines for a rough indicator
  const lineCount = (content || '').split('\n').length;
  const charCount = (content || '').length;

  return (
    <div className="flex gap-2.5 py-2 border-b border-gray-100 animate-fade-slide-in">
      <div className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5 min-w-12">...</div>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] text-white shrink-0"
        style={{ background: color.dot }}
      >
        ⚡
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold flex items-center gap-1.5">
          <span style={{ color: color.dot }}>{agentName}</span>
          <span className="flex items-center gap-1 text-[11px] font-normal" style={{ color: color.dot }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color.dot }} />
            Streaming...
          </span>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all cursor-pointer select-none"
            style={{
              background: collapsed ? color.bg || '#f0f9ff' : 'white',
              borderColor: collapsed ? color.dot : '#e5e7eb',
              color: collapsed ? color.dot : '#6b7280',
            }}
            title={collapsed ? 'Expand streaming output' : 'Collapse streaming output'}
          >
            <span
              className="inline-block transition-transform duration-200"
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            >
              ▾
            </span>
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>

        {collapsed ? (
          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400 italic">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: color.dot }}
            />
            Generating… ({charCount.toLocaleString()} chars)
          </div>
        ) : (
          <div ref={contentRef}>
            <div
              className="md-prose text-[13px] text-gray-800 mt-1"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content || '') }}
            />
            <span className="streaming-cursor" />
          </div>
        )}
      </div>
    </div>
  );
}
