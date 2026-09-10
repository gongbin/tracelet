import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/app.css';
import { startRouter } from './store/router.js';
import { initBridge } from './store/bridge.js';

const isDocs = /^\/docs\/?$/.test(location.pathname);
const Docs = React.lazy(() => import('./screens/Docs.js').then(module => ({ default: module.Docs })));
if (!isDocs) { startRouter(); initBridge(); }
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div role="status" style={{ padding: 32 }}>Tracelet…</div>}>
      {isDocs ? <Docs /> : <App />}
    </React.Suspense>
  </React.StrictMode>
);
