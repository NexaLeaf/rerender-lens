// rerender-lens is started by the Vite plugin (see vite.config.ts), before this module runs.
// Without the plugin you would `import './rerender-lens'` here, before react-dom.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
