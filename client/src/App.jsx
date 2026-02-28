import { useState, useRef, useCallback, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useOrchestration } from './context/OrchestrationContext.jsx';
import Header from './components/Header.jsx';
import TaskInput from './components/TaskInput.jsx';
import AgentTopology from './components/AgentTopology.jsx';
import ConversationFeed from './components/ConversationFeed.jsx';
import ProgressSidebar from './components/ProgressSidebar.jsx';
import SettingsModal from './components/SettingsModal.jsx';

/* Default column widths as percentages (must sum to 100) */
const DEFAULT_WIDTHS = [20, 52, 28]; // left (topology), center (conversation), right (progress)
const MIN_WIDTH_PCT = 12; // minimum panel width %

/* Maximize/restore icon button */
function MaximizeBtn({ isMaximized, onClick }) {
  return (
    <button
      onClick={onClick}
      className="panel-maximize-btn"
      title={isMaximized ? 'Restore panels' : 'Maximize panel'}
    >
      {isMaximized ? (
        /* Restore icon (shrink) */
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 14 10 14 10 20" />
          <polyline points="20 10 14 10 14 4" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      ) : (
        /* Maximize icon (expand) */
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      )}
    </button>
  );
}

export default function App() {
  const { sendTask, stopTask } = useWebSocket();
  const { progress, isProcessing } = useOrchestration();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const prevProgressRef = useRef(0);

  /* 🎉 Confetti burst when task completes (progress jumps to 100) */
  useEffect(() => {
    if (progress === 100 && prevProgressRef.current < 100) {
      // Multi-burst celebration
      const duration = 2000;
      const end = Date.now() + duration;

      // Initial big burst from center
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#6366f1', '#0d9488'],
      });

      // Continuous side bursts
      const interval = setInterval(() => {
        if (Date.now() > end) { clearInterval(interval); return; }
        confetti({
          particleCount: 30,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.65 },
          colors: ['#06b6d4', '#10b981', '#6366f1'],
        });
        confetti({
          particleCount: 30,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.65 },
          colors: ['#f59e0b', '#f43f5e', '#0d9488'],
        });
      }, 250);

      return () => clearInterval(interval);
    }
    prevProgressRef.current = progress;
  }, [progress]);

  /* Panel widths as percentages */
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  /* Which panel is maximized: null | 0 | 1 | 2 */
  const [maximized, setMaximized] = useState(null);

  const containerRef = useRef(null);
  const draggingRef = useRef(null); // { divider: 0|1, startX, startWidths }

  /* Toggle maximize for a panel */
  const toggleMaximize = useCallback((panelIdx) => {
    setMaximized((prev) => (prev === panelIdx ? null : panelIdx));
  }, []);

  /* --- Drag-to-resize logic --- */
  const onDividerMouseDown = useCallback((dividerIdx, e) => {
    e.preventDefault();
    draggingRef.current = {
      divider: dividerIdx,
      startX: e.clientX,
      startWidths: [...widths],
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [widths]);

  useEffect(() => {
    function onMouseMove(e) {
      const drag = draggingRef.current;
      if (!drag) return;
      const container = containerRef.current;
      if (!container) return;
      const containerW = container.getBoundingClientRect().width;
      const deltaPx = e.clientX - drag.startX;
      const deltaPct = (deltaPx / containerW) * 100;

      const newWidths = [...drag.startWidths];
      const leftIdx = drag.divider;
      const rightIdx = drag.divider + 1;

      newWidths[leftIdx] = drag.startWidths[leftIdx] + deltaPct;
      newWidths[rightIdx] = drag.startWidths[rightIdx] - deltaPct;

      // Enforce min widths
      if (newWidths[leftIdx] < MIN_WIDTH_PCT) {
        newWidths[rightIdx] -= (MIN_WIDTH_PCT - newWidths[leftIdx]);
        newWidths[leftIdx] = MIN_WIDTH_PCT;
      }
      if (newWidths[rightIdx] < MIN_WIDTH_PCT) {
        newWidths[leftIdx] -= (MIN_WIDTH_PCT - newWidths[rightIdx]);
        newWidths[rightIdx] = MIN_WIDTH_PCT;
      }
      if (newWidths[leftIdx] >= MIN_WIDTH_PCT && newWidths[rightIdx] >= MIN_WIDTH_PCT) {
        setWidths(newWidths);
      }
    }
    function onMouseUp() {
      if (draggingRef.current) {
        draggingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const isMaximized = maximized !== null;

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Header */}
      <Header onOpenSettings={() => setSettingsOpen(true)} />

      {/* Main 3-panel layout */}
      <div ref={containerRef} className="flex-1 flex p-3 gap-0 overflow-hidden">
        {/* Left: Agent Topology */}
        <div
          className={`panel-col ${isMaximized && maximized !== 0 ? 'panel-hidden' : ''} ${maximized === 0 ? 'panel-maximized' : ''}`}
          style={!isMaximized ? { width: `${widths[0]}%` } : undefined}
        >
          <div className="panel-inner">
            <MaximizeBtn isMaximized={maximized === 0} onClick={() => toggleMaximize(0)} />
            <AgentTopology />
          </div>
        </div>

        {/* Divider 1 */}
        {!isMaximized && (
          <div className="panel-divider" onMouseDown={(e) => onDividerMouseDown(0, e)}>
            <div className="panel-divider-line" />
          </div>
        )}

        {/* Center: Conversation Feed + Task Input */}
        <div
          className={`panel-col ${isMaximized && maximized !== 1 ? 'panel-hidden' : ''} ${maximized === 1 ? 'panel-maximized' : ''}`}
          style={!isMaximized ? { width: `${widths[1]}%` } : undefined}
        >
          <div className="panel-inner">
            <MaximizeBtn isMaximized={maximized === 1} onClick={() => toggleMaximize(1)} />
            <div className="flex flex-col overflow-hidden bg-white rounded-xl shadow-sm border border-gray-200 h-full">
              <TaskInput onSubmit={sendTask} onStop={stopTask} />
              <div className="flex-1 flex flex-col overflow-hidden">
                <ConversationFeed />
              </div>
            </div>
          </div>
        </div>

        {/* Divider 2 */}
        {!isMaximized && (
          <div className="panel-divider" onMouseDown={(e) => onDividerMouseDown(1, e)}>
            <div className="panel-divider-line" />
          </div>
        )}

        {/* Right: Progress Sidebar */}
        <div
          className={`panel-col ${isMaximized && maximized !== 2 ? 'panel-hidden' : ''} ${maximized === 2 ? 'panel-maximized' : ''}`}
          style={!isMaximized ? { width: `${widths[2]}%` } : undefined}
        >
          <div className="panel-inner">
            <MaximizeBtn isMaximized={maximized === 2} onClick={() => toggleMaximize(2)} />
            <ProgressSidebar />
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
