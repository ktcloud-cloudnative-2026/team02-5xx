import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Application from './Application.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Application />
  </StrictMode>,
);
