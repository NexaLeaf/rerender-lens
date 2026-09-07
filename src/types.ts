import type * as ReactNS from 'react';

/** Why a single prop/state/hook value differs between two renders. */
export type ChangeKind =
  /** New reference, but deep-equal to the previous value. Avoidable. */
  | 'deep-equal'
  /** A new function with the same name/body shape. Almost always avoidable. */
  | 'function'
  /** A new React element that renders the same type with deep-equal props. Avoidable. */
  | 'element'
  /** The value genuinely changed. */
  | 'different'
  /** Key was added. */
  | 'added'
  /** Key was removed. */
  | 'removed';

export interface Change {
  /** Dot path from the root, e.g. `style.color` or `items[2]`. */
  path: string;
  kind: ChangeKind;
  prev: unknown;
  next: unknown;
}

/** What caused a re-render. */
export type RenderTrigger =
  /** At least one prop genuinely changed. */
  | 'props'
  /** Props are equal by value, but the parent re-rendered. Wrap in React.memo. */
  | 'parent'
  /** Own state (useState/useReducer/this.setState) changed. */
  | 'state'
  /** A non-state hook value (useContext, useSyncExternalStore) changed. */
  | 'hooks'
  /** More than one of the above. */
  | 'mixed';

export interface HookChange extends Change {
  /** `useState`, `useReducer`, `useContext`, ... */
  hook: string;
  /** Position of the hook in call order (0-based). */
  index: number;
}

export interface RenderReport {
  /** Display name of the tracked component. */
  component: string;
  /** Monotonic per-component render count (1 = first update, mount is never reported). */
  renderCount: number;
  trigger: RenderTrigger;
  /** True when the re-render produced no genuine change in props, state, or hooks. */
  avoidable: boolean;
  props: { prev: Record<string, unknown>; next: Record<string, unknown> };
  propChanges: Change[];
  /** Class components only. */
  stateChanges: Change[];
  /** Function components only, when `trackHooks` is on. */
  hookChanges: HookChange[];
  /** Human-readable explanations and suggested fixes. */
  reasons: string[];
  /** `performance.now()` (or `Date.now()`) when the report was produced. */
  time: number;
}

export type Notifier = (report: RenderReport) => void;

export type ComponentMatcher = string | RegExp | ((displayName: string) => boolean);

export interface Options {
  /** Track every `React.memo`-wrapped component and every `PureComponent`. Default false. */
  trackAllMemoized?: boolean;
  /** Track every component, memoized or not. Noisy. Default false. */
  trackAllComponents?: boolean;
  /** Components to track by display name (string = exact match). */
  include?: ComponentMatcher[];
  /** Components never to track, even when marked. */
  exclude?: ComponentMatcher[];
  /** Capture `useState`/`useReducer`/`useContext` values and diff them. Default true. */
  trackHooks?: boolean;
  /** Report re-renders caused by genuine changes too, not only avoidable ones. Default false. */
  logAll?: boolean;
  /** Do not print to the console. Reports still reach `notifier`. Default false. */
  silent?: boolean;
  /** Receive every report. Combine several with `combineNotifiers`. */
  notifier?: Notifier;
  /** Use `console.groupCollapsed` instead of `console.group`. Default true. */
  collapse?: boolean;
  /** Console-like sink used for printing. Default `console`. */
  console?: Pick<Console, 'log' | 'group' | 'groupCollapsed' | 'groupEnd' | 'warn'>;
}

/**
 * The React object to patch. Structural so that both `import React from 'react'`
 * and `import * as React from 'react'` type-check.
 */
export type ReactLike = Pick<typeof ReactNS, 'createElement' | 'memo' | 'forwardRef' | 'useRef'> &
  Partial<Pick<typeof ReactNS, 'useState' | 'useReducer' | 'useContext' | 'useSyncExternalStore'>>;

/** Marker static: `MyComponent.rerenderLens = true` opts a component in. */
export const MARKER = 'rerenderLens' as const;

export interface TrackableStatics {
  [MARKER]?: boolean;
  displayName?: string;
  name?: string;
}
