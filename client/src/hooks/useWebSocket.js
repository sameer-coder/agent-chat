import { useEffect, useRef, useCallback } from 'react';
import { useOrchestrationDispatch } from '../context/OrchestrationContext.jsx';
import { ActionTypes } from '../context/orchestrationReducer.js';

/**
 * Normalize agent identifier to an integer index.
 */
function normalizeAgentIndex(agent) {
  if (typeof agent === 'number') return agent;
  const s = String(agent).toLowerCase();
  if (s === 'alpha' || s === 'sub-agent-alpha') return 0;
  if (s === 'beta' || s === 'sub-agent-beta') return 1;
  const m = s.match(/sub-agent-(\d+)/);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  return -1;
}

export function useWebSocket() {
  const dispatch = useOrchestrationDispatch();
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const connectRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      dispatch({ type: ActionTypes.SET_CONNECTED, connected: true });
    };

    ws.onclose = () => {
      dispatch({ type: ActionTypes.SET_CONNECTED, connected: false });
      reconnectTimer.current = setTimeout(() => connectRef.current?.(), 3000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleMessage(data, dispatch);
    };
  }, [dispatch]);

  // Keep ref in sync so reconnect closure always calls latest
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendTask = useCallback((task) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      dispatch({ type: ActionTypes.START_TASK, task });
      wsRef.current.send(JSON.stringify({ type: 'task', task }));
    }
  }, [dispatch]);

  const stopTask = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  return { sendTask, stopTask };
}

let _cachedAgentNames = {};
let _edgeIdCounter = 0;

/** Dispatch a temporary active-edge for topology lightning animation */
function fireEdge(dispatch, from, to) {
  const id = ++_edgeIdCounter;
  dispatch({ type: ActionTypes.ADD_ACTIVE_EDGE, from, to, id });
  setTimeout(() => {
    dispatch({ type: ActionTypes.REMOVE_ACTIVE_EDGE, id });
  }, 1400);
}

/** Normalize a from/to agent identifier to the key used in topology positions ('master' or integer index) */
function topoKey(agent) {
  if (agent === 'master' || agent === 'master-handler') return 'master';
  const idx = normalizeAgentIndex(agent);
  return idx >= 0 ? idx : 'master';
}

function handleMessage(data, dispatch) {
  const agentIndex = data.agentIndex !== undefined
    ? data.agentIndex
    : normalizeAgentIndex(data.agent);

  switch (data.type) {
    case 'connected':
      dispatch({
        type: ActionTypes.SET_API_STATUS,
        configured: data.apiConfigured,
        config: data.config,
      });
      break;

    case 'agent-names':
      _cachedAgentNames = data.names || {};
      dispatch({
        type: ActionTypes.SET_AGENT_NAMES,
        names: data.names,
        count: data.count,
      });
      // Add "Task received by Master Agent" banner
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: { type: 'task-received', text: 'Task received by Master Agent' },
      });
      break;

    case 'status':
      if (data.agent === 'master-handler' || data.agent === 'system') {
        dispatch({
          type: ActionTypes.ADD_MESSAGE,
          message: { type: 'status', agent: data.agent, text: data.message },
        });
        if (data.agent === 'master-handler') {
          dispatch({
            type: ActionTypes.UPDATE_AGENT_STATUS,
            agent: 'master-handler',
            status: data.message,
          });
        }
      } else {
        dispatch({
          type: ActionTypes.ADD_MESSAGE,
          message: { type: 'status', agentIndex, text: data.message },
        });
        dispatch({
          type: ActionTypes.UPDATE_AGENT_STATUS,
          agentIndex,
          status: data.message,
        });
        // Mark subtask as active when agent starts working
        dispatch({
          type: ActionTypes.UPDATE_SUBTASK_STATUS,
          agentIndex,
          status: 'active',
        });
      }
      break;

    case 'task-breakdown':
      dispatch({
        type: ActionTypes.SET_TASK_BREAKDOWN,
        explanation: data.message,
        subtasks: data.subtasks,
      });
      // Add individual "Agent spawned" banners
      if (data.subtasks) {
        const SPAWN_ICONS = ['📄', '🔍', '💻', '🔎', '🧪'];
        data.subtasks.forEach((_task, i) => {
          const agentName = _cachedAgentNames[i] || `Agent ${i}`;
          dispatch({
            type: ActionTypes.ADD_MESSAGE,
            message: {
              type: 'agent-spawned',
              text: `${agentName} spawned`,
              icon: SPAWN_ICONS[i % SPAWN_ICONS.length],
              agentIndex: i,
            },
          });
        });
      }
      break;

    case 'streaming':
      dispatch({
        type: ActionTypes.APPEND_STREAM,
        agentIndex,
        chunk: data.chunk,
      });
      dispatch({
        type: ActionTypes.UPDATE_AGENT_STATUS,
        agentIndex,
        status: 'Streaming...',
      });
      break;

    case 'stream-end':
      dispatch({ type: ActionTypes.END_STREAM, agentIndex });
      dispatch({
        type: ActionTypes.UPDATE_AGENT_STATUS,
        agentIndex,
        status: 'Stream complete',
      });
      break;

    case 'task-complete':
      dispatch({
        type: ActionTypes.UPDATE_AGENT_STATUS,
        agentIndex,
        status: 'Completed',
      });
      dispatch({
        type: ActionTypes.UPDATE_SUBTASK_STATUS,
        agentIndex,
        status: 'done',
      });
      break;

    case 'agent-result':
      dispatch({
        type: ActionTypes.SET_AGENT_RESULT,
        agentIndex,
        result: data.message,
      });
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'agent-result',
          agentIndex,
          text: data.message,
          round: data.round || 1,
        },
      });
      dispatch({
        type: ActionTypes.UPDATE_SUBTASK_STATUS,
        agentIndex,
        status: 'done',
      });
      break;

    case 'evaluation':
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'evaluation',
          text: data.message,
          satisfied: data.satisfied,
          round: data.round,
        },
      });
      break;

    case 'follow-up-assignment':
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'follow-up',
          agentIndex: data.agentIndex !== undefined ? data.agentIndex : normalizeAgentIndex(data.target),
          text: data.message,
          round: data.round,
        },
      });
      break;

    case 'agent-communication':
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'agent-communication',
          from: data.from,
          to: data.to,
          text: data.message,
        },
      });
      fireEdge(dispatch, topoKey(data.from), topoKey(data.to));
      break;

    case 'agent-question':
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'agent-question',
          from: data.from,
          to: data.to,
          text: data.message,
        },
      });
      fireEdge(dispatch, topoKey(data.from), topoKey(data.to));
      break;

    case 'agent-answer':
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'agent-answer',
          from: data.from,
          to: data.to,
          text: data.message,
        },
      });
      fireEdge(dispatch, topoKey(data.from), topoKey(data.to));
      break;

    case 'retry':
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'retry',
          agent: data.agent,
          agentIndex,
          text: data.message,
          attempt: data.attempt,
          maxRetries: data.maxRetries,
        },
      });
      break;

    case 'warning':
      dispatch({
        type: ActionTypes.ADD_MESSAGE,
        message: {
          type: 'warning',
          agent: data.agent,
          agentIndex,
          text: data.message,
        },
      });
      break;

    case 'complete':
      dispatch({ type: ActionTypes.TASK_COMPLETE, message: data.message });
      break;

    case 'stopped':
      dispatch({ type: ActionTypes.TASK_STOPPED });
      break;

    case 'error':
      dispatch({ type: ActionTypes.TASK_ERROR, message: data.message });
      break;

    case 'token-usage':
      dispatch({
        type: ActionTypes.UPDATE_TOKEN_USAGE,
        promptTokens: data.promptTokens || 0,
        completionTokens: data.completionTokens || 0,
        totalTokens: data.totalTokens || 0,
        model: data.model || '',
      });
      dispatch({
        type: ActionTypes.CORRELATE_SNAPSHOT_TOKENS,
        promptTokens: data.promptTokens || 0,
        model: data.model || '',
      });
      break;

    case 'context-snapshot':
      dispatch({
        type: ActionTypes.ADD_CONTEXT_SNAPSHOT,
        snapshot: {
          callId: data.callId,
          agentLabel: data.agentLabel,
          timestamp: data.timestamp,
          model: data.model,
          sections: data.sections,
          totalEstimatedTokens: data.totalEstimatedTokens,
          messages: data.messages || [],
        },
      });
      break;
  }
}
