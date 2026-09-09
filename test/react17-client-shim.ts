/**
 * `react-dom/client` for React 17, which has no root API: `test/react-compat.config.ts` aliases the
 * module to this file when REACT_COMPAT_DIR points at a React 17 install, so `test/helpers.ts`
 * works unchanged. Only the two methods the harness uses are provided.
 */
import ReactDOM from 'react-dom';
import type { ReactElement } from 'react';

export interface LegacyRoot {
  render(element: ReactElement): void;
  unmount(): void;
}

export function createRoot(container: Element | DocumentFragment): LegacyRoot {
  const node = container as Element;
  return {
    render: (element) => (ReactDOM as unknown as { render(e: ReactElement, c: Element): void }).render(element, node),
    unmount: () => (ReactDOM as unknown as { unmountComponentAtNode(c: Element): void }).unmountComponentAtNode(node),
  };
}
