// Agent color palettes indexed by position
export const AGENT_COLORS = [
  { key: 'cyan',    dot: '#06b6d4', bg: '#ecfeff',  border: '#a5f3fc', headerBg: '#cffafe',  text: '#0e7490',  badge: '#06b6d4' },
  { key: 'emerald', dot: '#10b981', bg: '#ecfdf5',  border: '#6ee7b7', headerBg: '#d1fae5',  text: '#047857',  badge: '#10b981' },
  { key: 'amber',   dot: '#f59e0b', bg: '#fffbeb',  border: '#fcd34d', headerBg: '#fef3c7',  text: '#b45309',  badge: '#f59e0b' },
  { key: 'rose',    dot: '#f43f5e', bg: '#fff1f2',  border: '#fda4af', headerBg: '#ffe4e6',  text: '#be123c',  badge: '#f43f5e' },
  { key: 'indigo',  dot: '#6366f1', bg: '#eef2ff',  border: '#a5b4fc', headerBg: '#e0e7ff',  text: '#4338ca',  badge: '#6366f1' },
];

export const MASTER_COLOR = { dot: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', headerBg: '#ccfbf1', text: '#0f766e', badge: '#0d9488' };

export function getAgentColor(index) {
  if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) return MASTER_COLOR;
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

// Agent icons (emoji) for the topology visualization
export const AGENT_ICONS = ['⚡', '🔍', '💻', '🔎', '🧪'];
export const MASTER_ICON = '🎯';

export function getAgentIcon(index) {
  if (index < 0) return MASTER_ICON;
  return AGENT_ICONS[index % AGENT_ICONS.length];
}

// ── Initial state ──
export const initialState = {
  // Connection
  isConnected: false,
  apiConfigured: false,
  currentConfig: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },

  // Task
  isProcessing: false,
  currentTask: '',

  // Agents
  agentNames: {},   // { 0: 'Researcher', 1: 'Coder', ... }
  agentCount: 0,
  agentStatus: {},  // { 0: 'Working', master: 'Analyzing' }
  agentResults: {}, // { 0: 'result text...', 1: '...' }

  // Messages for conversation feed
  messages: [],     // [{ id, type, timestamp, ...payload }]

  // Task breakdown
  subtasks: [],     // [{ agentIndex, task, status }]

  // Streaming
  streamingBuffers: {},  // { agentIndex: 'accumulated text' }

  // UI state
  selectedAgent: null,  // null | 'master' | agentIndex
  feedFilter: 'all',    // 'all' | 'thinking' | 'message' | 'result'

  // Progress
  progress: 0,          // 0-100
  startTime: null,

  // Active communication edges for topology lightning animation
  // Each entry: { from, to, id, timestamp }
  activeEdges: [],
};

/**
 * Compute progress (0-100) from subtask statuses.
 * Reserves 5% for initial setup and 5% for final synthesis.
 * Each subtask contributes equally to the middle 90%.
 *   pending → 0, active → 0.4, done → 1.0
 */
function computeProgress(subtasks) {
  if (!subtasks || subtasks.length === 0) return 0;
  const weights = subtasks.map(st =>
    st.status === 'done' ? 1 : st.status === 'active' ? 0.4 : 0
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  const ratio = sum / subtasks.length;
  // 5% base (task accepted) + up to 90% from subtask progress
  return Math.min(95, Math.round(5 + ratio * 90));
}

// ── Action types ──
export const ActionTypes = {
  // Connection
  SET_CONNECTED: 'SET_CONNECTED',
  SET_API_STATUS: 'SET_API_STATUS',

  // Task lifecycle
  START_TASK: 'START_TASK',
  TASK_STOPPED: 'TASK_STOPPED',
  TASK_ERROR: 'TASK_ERROR',
  TASK_COMPLETE: 'TASK_COMPLETE',

  // Agents
  SET_AGENT_NAMES: 'SET_AGENT_NAMES',
  UPDATE_AGENT_STATUS: 'UPDATE_AGENT_STATUS',
  SET_AGENT_RESULT: 'SET_AGENT_RESULT',

  // Messages
  ADD_MESSAGE: 'ADD_MESSAGE',
  SET_TASK_BREAKDOWN: 'SET_TASK_BREAKDOWN',
  UPDATE_SUBTASK_STATUS: 'UPDATE_SUBTASK_STATUS',

  // Streaming
  APPEND_STREAM: 'APPEND_STREAM',
  END_STREAM: 'END_STREAM',

  // UI
  SELECT_AGENT: 'SELECT_AGENT',
  SET_FEED_FILTER: 'SET_FEED_FILTER',
  SET_PROGRESS: 'SET_PROGRESS',

  // Communication edges
  ADD_ACTIVE_EDGE: 'ADD_ACTIVE_EDGE',
  REMOVE_ACTIVE_EDGE: 'REMOVE_ACTIVE_EDGE',
  CLEAR_ACTIVE_EDGES: 'CLEAR_ACTIVE_EDGES',
};

let messageIdCounter = 0;
function nextMsgId() { return ++messageIdCounter; }

function now() { return Date.now(); }

function elapsed(startTime) {
  if (!startTime) return '0:00';
  const s = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ── Reducer ──
export function orchestrationReducer(state, action) {
  switch (action.type) {

    case ActionTypes.SET_CONNECTED:
      return { ...state, isConnected: action.connected };

    case ActionTypes.SET_API_STATUS:
      return {
        ...state,
        apiConfigured: action.configured,
        currentConfig: action.config || state.currentConfig,
      };

    case ActionTypes.START_TASK:
      messageIdCounter = 0;
      return {
        ...state,
        isProcessing: true,
        currentTask: action.task,
        messages: [{
          id: nextMsgId(), type: 'user', text: action.task, timestamp: now(),
          timeLabel: '0:00',
        }],
        agentResults: {},
        streamingBuffers: {},
        subtasks: [],
        progress: 0,
        startTime: Date.now(),
        agentStatus: {},
        selectedAgent: null,
        activeEdges: [],
      };

    case ActionTypes.SET_AGENT_NAMES:
      return {
        ...state,
        agentNames: action.names,
        agentCount: action.count || Object.keys(action.names).length,
      };

    case ActionTypes.ADD_MESSAGE: {
      const msg = {
        ...action.message,
        id: nextMsgId(),
        timestamp: now(),
        timeLabel: elapsed(state.startTime),
      };

      // For retry messages, replace the previous retry for the same agent
      // so only the latest attempt is visible (retries are sequential, not simultaneous)
      if (msg.type === 'retry') {
        const retryAgent = msg.agent ?? msg.agentIndex;
        const idx = state.messages.findLastIndex(
          (m) => m.type === 'retry' && (m.agent ?? m.agentIndex) === retryAgent
        );
        if (idx !== -1) {
          const updated = [...state.messages];
          updated[idx] = msg;
          return { ...state, messages: updated };
        }
      }

      return { ...state, messages: [...state.messages, msg] };
    }

    case ActionTypes.SET_TASK_BREAKDOWN: {
      const subtasks = action.subtasks.map((task, i) => ({
        agentIndex: i,
        task,
        status: 'pending', // pending | active | done
      }));
      const msg = {
        id: nextMsgId(),
        type: 'task-breakdown',
        explanation: action.explanation,
        subtasks: action.subtasks,
        timestamp: now(),
        timeLabel: elapsed(state.startTime),
      };
      return { ...state, subtasks, progress: 5, messages: [...state.messages, msg] };
    }

    case ActionTypes.UPDATE_SUBTASK_STATUS: {
      const subtasks = state.subtasks.map((st) =>
        st.agentIndex === action.agentIndex ? { ...st, status: action.status } : st
      );
      const progress = computeProgress(subtasks);
      return { ...state, subtasks, progress };
    }

    case ActionTypes.UPDATE_AGENT_STATUS: {
      const key = action.agent === 'master-handler' ? 'master' : action.agentIndex;
      return {
        ...state,
        agentStatus: { ...state.agentStatus, [key]: action.status },
      };
    }

    case ActionTypes.SET_AGENT_RESULT: {
      return {
        ...state,
        agentResults: { ...state.agentResults, [action.agentIndex]: action.result },
      };
    }

    case ActionTypes.APPEND_STREAM: {
      const idx = action.agentIndex;
      const prev = state.streamingBuffers[idx] || '';
      return {
        ...state,
        streamingBuffers: { ...state.streamingBuffers, [idx]: prev + action.chunk },
      };
    }

    case ActionTypes.END_STREAM: {
      const { [action.agentIndex]: _, ...rest } = state.streamingBuffers;
      return { ...state, streamingBuffers: rest };
    }

    case ActionTypes.TASK_COMPLETE: {
      const msg = {
        id: nextMsgId(),
        type: 'complete',
        text: action.message,
        timestamp: now(),
        timeLabel: elapsed(state.startTime),
      };
      const subtasks = state.subtasks.map(st => ({ ...st, status: 'done' }));
      // Mark every agent (master + all sub-agents) as Completed and clear any
      // lingering streaming buffers so no agent can show "Working" after the
      // master has finished synthesizing the final answer.
      const finalAgentStatus = {};
      for (const key of Object.keys(state.agentStatus)) {
        finalAgentStatus[key] = 'Completed';
      }
      finalAgentStatus.master = 'Completed';
      return {
        ...state,
        isProcessing: false,
        progress: 100,
        messages: [...state.messages, msg],
        subtasks,
        streamingBuffers: {},
        agentStatus: finalAgentStatus,
      };
    }

    case ActionTypes.TASK_STOPPED: {
      const msg = {
        id: nextMsgId(),
        type: 'stopped',
        timestamp: now(),
        timeLabel: elapsed(state.startTime),
      };
      return {
        ...state,
        isProcessing: false,
        streamingBuffers: {},
        messages: [...state.messages, msg],
      };
    }

    case ActionTypes.TASK_ERROR: {
      const msg = {
        id: nextMsgId(),
        type: 'error',
        text: action.message,
        timestamp: now(),
        timeLabel: elapsed(state.startTime),
      };
      return {
        ...state,
        isProcessing: false,
        streamingBuffers: {},
        messages: [...state.messages, msg],
      };
    }

    case ActionTypes.SELECT_AGENT:
      return { ...state, selectedAgent: action.agent };

    case ActionTypes.SET_FEED_FILTER:
      return { ...state, feedFilter: action.filter };

    case ActionTypes.SET_PROGRESS:
      return { ...state, progress: action.progress };

    case ActionTypes.ADD_ACTIVE_EDGE: {
      const edge = { from: action.from, to: action.to, id: action.id, timestamp: Date.now() };
      return { ...state, activeEdges: [...state.activeEdges, edge] };
    }

    case ActionTypes.REMOVE_ACTIVE_EDGE:
      return { ...state, activeEdges: state.activeEdges.filter(e => e.id !== action.id) };

    case ActionTypes.CLEAR_ACTIVE_EDGES:
      return { ...state, activeEdges: [] };

    default:
      return state;
  }
}
