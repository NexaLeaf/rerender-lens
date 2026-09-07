import type { Options, ReactLike, RenderReport } from './types';
import { printReport } from './report';

export interface HookSample {
  hook: string;
  value: unknown;
}

type PatchableKey = 'createElement' | 'useState' | 'useReducer' | 'useContext' | 'useSyncExternalStore';

export interface LensState {
  React: ReactLike | null;
  options: Options;
  /** Bumped by configure(); invalidates cached track/no-track decisions. */
  generation: number;
  decisions: WeakMap<object, { generation: number; tracked: boolean }>;
  wrappers: WeakMap<object, object>;
  wrapperSet: WeakSet<object>;
  originals: Partial<Record<PatchableKey, (...args: unknown[]) => unknown>>;
  /** Hook samples for the tracked component currently rendering, if any. */
  capture: HookSample[] | null;
  patched: boolean;
}

const KEY = Symbol.for('rerender-lens.state');

/**
 * State lives on globalThis so that the ESM and CJS builds, and the main and
 * jsx-runtime entries, always share one instance.
 */
export function getState(): LensState {
  const g = globalThis as unknown as Record<symbol, LensState | undefined>;
  let s = g[KEY];
  if (!s) {
    s = {
      React: null,
      options: {},
      generation: 0,
      decisions: new WeakMap(),
      wrappers: new WeakMap(),
      wrapperSet: new WeakSet(),
      originals: {},
      capture: null,
      patched: false,
    };
    g[KEY] = s;
  }
  return s;
}

/** Print (unless silent / not avoidable) and forward to the notifier. */
export function dispatch(report: RenderReport, override?: Options): void {
  const options: Options = override ? { ...getState().options, ...override } : getState().options;
  if (!options.silent && (report.avoidable || options.logAll)) {
    printReport(report, options);
  }
  if (options.notifier) {
    try {
      options.notifier(report);
    } catch (err) {
      (options.console ?? console).warn('[rerender-lens] notifier threw', err);
    }
  }
}
