// Manual setup, for apps without the Vite plugin: import this file before react-dom so the DevTools
// hook exists when react-dom loads (not needed when the React DevTools extension is installed or
// Vite's Fast Refresh preamble runs). The example uses the plugin instead (vite.config.ts).
import { init, createDevtoolsNotifier } from 'rerender-lens';

if (import.meta.env.DEV) {
  init({
    trackAllMemoized: true,
    include: ['Row'], // one deliberately un-memoized component
    notifier: createDevtoolsNotifier(),
  });
}
