import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './app/App'
import { Providers } from './app/providers'
import './index.css'
import { initializeFrontendErrorMonitoring } from './lib/errorMonitoring'

initializeFrontendErrorMonitoring()
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>
)
