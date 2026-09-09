import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from './react-act';
import { createCollector, disable, init, type Options } from '../src/index';

type Root = ReturnType<typeof createRoot>;

export interface Harness {
  root: Root;
  container: HTMLElement;
  render(el: React.ReactElement): void;
  unmount(): void;
}

export function mount(el: React.ReactElement): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return {
    root,
    container,
    render: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function silentConsole() {
  const calls: string[] = [];
  const c = {
    log: (...a: unknown[]) => void calls.push(a.map(String).join(' ')),
    group: (...a: unknown[]) => void calls.push(`group ${a.map(String).join(' ')}`),
    groupCollapsed: (...a: unknown[]) => void calls.push(`group ${a.map(String).join(' ')}`),
    groupEnd: () => void calls.push('groupEnd'),
    warn: (...a: unknown[]) => void calls.push(`warn ${a.map(String).join(' ')}`),
  };
  return { console: c, calls };
}

/** init() with a collector and a captured console; returns everything needed for assertions. */
export function setup(options: Options = {}) {
  const collector = createCollector();
  const con = silentConsole();
  init({ notifier: collector.notifier, console: con.console, ...options });
  return { collector, calls: con.calls, teardown: disable };
}

export const h = React.createElement;
