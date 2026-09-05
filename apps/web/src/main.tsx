import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/app.css';
import { startRouter } from './store/router.js';
import { initBridge } from './store/bridge.js';

startRouter();
initBridge();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
