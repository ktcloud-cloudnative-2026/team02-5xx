// Test-only controls: actual Auth Store and HTTP menu adapter, never a product entry.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { authSession } from '../src/authSession.js';
import { menuApi } from '../src/data/menuApi.js';
import '../src/index.css';

const control = {
  ignoreAbort: window.__ignoreMenuAbort === true,
  settled: 0,
  session: authSession,
};
const adapter = {
  list: (...args) => menuApi.list(...args),
  async detail(id, options) {
    try {
      return await menuApi.detail(id, control.ignoreAbort ? {} : options);
    } finally {
      control.settled++;
    }
  },
};
let root;
control.mount = () => {
  root = createRoot(document.getElementById('root'));
  root.render(
    <StrictMode>
      <App menuApi={adapter} />
    </StrictMode>,
  );
};
control.unmount = () => root.unmount();
window.__integration = control;
control.mount();
