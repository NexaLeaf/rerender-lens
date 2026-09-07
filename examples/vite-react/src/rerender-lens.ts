// Import this before react-dom so the DevTools hook exists when react-dom loads
// (not needed when the React DevTools extension is installed or Vite's Fast Refresh preamble runs).
import { init, createDevtoolsNotifier } from 'rerender-lens';

if (import.meta.env.DEV) {
  init({
    trackAllMemoized: true,
    include: ['Row'], // one deliberately un-memoized component
    notifier: createDevtoolsNotifier(),
  });
}
