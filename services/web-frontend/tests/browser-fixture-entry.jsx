// Test-only session injection. This entry is never included by the production index.html.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import '../src/index.css';

let snapshot = null;
let resumeOnLogin = false;
const listeners = new Set();
const sessionSource = {
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,
};
function publish(next) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
document.getElementById('test-sign-in').onclick = () =>
  publish({ authenticated: true, role: 'CUSTOMER' });
document.getElementById('test-sign-out').onclick = () => publish(null);
document.getElementById('test-pending').onclick = () => {
  resumeOnLogin = true;
};
new MutationObserver(() => {
  if (resumeOnLogin && document.querySelector('dialog.login-modal[open]')) {
    resumeOnLogin = false;
    publish({ authenticated: true, role: 'CUSTOMER' });
  }
}).observe(document.body, { childList: true, subtree: true, attributes: true });
createRoot(document.getElementById('root')).render(
  <App sessionSource={sessionSource} />,
);
