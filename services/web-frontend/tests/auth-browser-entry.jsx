// Test-only entry: actual session implementation, no injected login or role.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import '../src/index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
