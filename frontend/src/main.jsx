import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'react-phone-input-2/lib/style.css'
import './index.css'
import App from './App.jsx'

// Auto-reload on stale chunk dynamic import failures after new deployments
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)

