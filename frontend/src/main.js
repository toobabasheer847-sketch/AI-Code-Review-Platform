import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { Providers } from './app/providers';
import './index.css';
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(Providers, { children: _jsx(App, {}) }) }));
