// Control run for PR #111: a non-doc, behaviourally inert edit so the CI gate
// does not skip the WebKit suite. This branch is otherwise main at 3968255.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { registerServiceWorker } from './lib/offline'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

registerServiceWorker()

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
