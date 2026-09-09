/**
 * Mounting for the Jest app. `@testing-library/react` is not a dependency of this repo, so this is
 * react-dom/client plus `act`, like `test/helpers.ts` on the Vitest side.
 */
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

export function mount(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    render: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Run a state update the way an event would. */
export const run = (fn: () => void): void => void act(fn);
