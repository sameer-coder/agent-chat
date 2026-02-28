import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { OrchestrationProvider } from './context/OrchestrationContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <OrchestrationProvider>
      <App />
    </OrchestrationProvider>
  </StrictMode>,
)
