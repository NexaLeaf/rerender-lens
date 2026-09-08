// Same app, but without importing rerender-lens: the page for trying the extension's
// "Inject the library" mode (Settings, or the toolbar popup). Served at /plain.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
