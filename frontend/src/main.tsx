import React from 'react'
import ReactDOM from 'react-dom/client'
import { Providers } from './app/providers'
import App from './app/App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>
)
