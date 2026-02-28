import { createContext, useContext, useReducer } from 'react';
import { orchestrationReducer, initialState } from './orchestrationReducer.js';

const OrchestrationContext = createContext(null);
const OrchestrationDispatchContext = createContext(null);

export function OrchestrationProvider({ children }) {
  const [state, dispatch] = useReducer(orchestrationReducer, initialState);

  return (
    <OrchestrationContext.Provider value={state}>
      <OrchestrationDispatchContext.Provider value={dispatch}>
        {children}
      </OrchestrationDispatchContext.Provider>
    </OrchestrationContext.Provider>
  );
}

export function useOrchestration() {
  const ctx = useContext(OrchestrationContext);
  if (ctx === null) throw new Error('useOrchestration must be used inside OrchestrationProvider');
  return ctx;
}

export function useOrchestrationDispatch() {
  const ctx = useContext(OrchestrationDispatchContext);
  if (ctx === null) throw new Error('useOrchestrationDispatch must be used inside OrchestrationProvider');
  return ctx;
}
