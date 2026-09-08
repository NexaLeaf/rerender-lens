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
  /** `useState`, `useReducer`, `useContext`, `useSyncExternalStore`, or `state` when the exact hook is unknown. */
  hook: string;
  /** Position of the hook in call order (0-based). */
  index: number;
  /** `useContext` only: the component that renders the nearest matching Provider, and its ancestry. */
  provider?: { component: string | null; path: string[] };
  /** `useContext` only, object values: top-level keys whose value changed (shallow), and how many keys the value has. */
  changedKeys?: string[];
  totalKeys?: number;
  /** Custom hooks between the component and this primitive, innermost first (`resolveHookNames` option). */
  custom?: string[];
}

/** Current value of one state-bearing hook (`useState`, `useReducer`, `useSyncExternalStore`) after the render. */
export interface HookSnapshot {
  /** Same label as `HookChange.path`, e.g. `useState#0`. */
  path: string;
  hook: string;
  index: number;
  value: unknown;
  /** Custom hooks between the component and this primitive, innermost first (`resolveHookNames` option). */
  custom?: string[];
}

/** What made React commit, beyond the usual state/props story. */
export type CommitCause =
  /** State was set right after the previous commit by a component that rendered in it: an effect → setState loop. */
  | 'effect-after-commit'
  /** A Suspense boundary switched from its fallback to content. */
  | 'suspense-resolved';

/** Scheduler priority of the commit, as React reports it to the DevTools hook (transitions run at `normal`). */
export type CommitPriority = 'immediate' | 'user-blocking' | 'normal' | 'low' | 'idle';

export interface ParentInfo {
  /** Display name of the nearest ancestor component that also rendered in this commit. */
  name: string;
  /** Why that ancestor rendered. */
  trigger: RenderTrigger;
}

/** Where a component's element was created (React <= 18: `_debugSource`; React 19: parsed from `_debugStack`). */
export interface SourceLocation {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface RenderReport {
  /** Display name of the tracked component. */
  component: string;
  /** Stable id of this component instance (fiber) across its lifetime. */
  instanceId: number;
  /** Monotonic id of the React commit that produced this report. Reports from one commit share it. 0 for `useWhyRerender`. */
  commitId: number;
  /** Priority React assigned to the commit: `immediate` for discrete input (clicks, keys), `user-blocking` for continuous input, `normal` for transitions and async updates. */
  commitPriority?: CommitPriority;
  /** Components that scheduled the update (`setState`, dispatch) for this commit, from React's updater tracking (dev builds). */
  updaters?: string[];
  commitCause?: CommitCause;
  /** For `effect-after-commit`: the commit whose effects set the state. */
  afterCommit?: number;
  /** The element's `key`, when it has one. */
  key?: string | null;
  /** Monotonic per-instance update count (1 = first update; mount is never reported). */
  renderCount: number;
  trigger: RenderTrigger;
  /** True when the re-render produced no genuine change in props, state, or hooks. */
  avoidable: boolean;
  props: { prev: Record<string, unknown>; next: Record<string, unknown> };
  propChanges: Change[];
  /** Class components only. */
  stateChanges: Change[];
  /** Function components: state hooks and contexts that changed. */
  hookChanges: HookChange[];
  /** Function components: every state hook with its current value (changed or not). Omitted when `includeState` is off. */
  hookState?: HookSnapshot[];
  /** Every context the component reads, with its current value. Omitted when `includeState` is off. */
  contexts?: { name: string; value: unknown }[];
  /** Class components: `this.state` after the render. Omitted when `includeState` is off. */
  state?: Record<string, unknown>;
  /** Nearest ancestor that rendered in the same commit, or null when the update started here. */
  parent: ParentInfo | null;
  /** Component that created this element (dev builds only). */
  owner: string | null;
  /** Component ancestry from the root down to this component, display names only. */
  path: string[];
  /** True for `React.memo` components and `PureComponent` classes: props alone decide whether they re-render. */
  memoized: boolean;
  /** Time spent in this component's own render (children excluded), in ms, when React exposes it (dev/profiling builds). */
  selfDuration?: number;
  /** Time spent rendering this component and everything below it that rendered in the same commit, in ms. */
  treeDuration?: number;
  /** Source location of the element that rendered this component, when React exposes it (dev builds). */
  source?: SourceLocation;
  /** Human-readable explanations and suggested fixes. */
  reasons: string[];
  /** `performance.now()` (or `Date.now()`) when the report was produced. */
  time: number;
}

/**
 * The fields the analysis helpers (`fixesFor`, `rankFixes`, `summarizeReports`, `summarize`) read,
 * as a structural type: both a live `RenderReport` and the DevTools panel's serialized report satisfy
 * it, so the panel and the library share one implementation without casts.
 */
export interface ChangeLike {
  path: string;
  kind: ChangeKind;
  prev?: unknown;
  next?: unknown;
  hook?: string;
  index?: number;
  provider?: { component: string | null; path: string[] };
  changedKeys?: string[];
  totalKeys?: number;
  custom?: string[];
}

export interface ReportLike {
  component: string;
  avoidable: boolean;
  trigger: string;
  memoized?: boolean;
  propChanges: ChangeLike[];
  stateChanges: ChangeLike[];
  hookChanges: ChangeLike[];
  parent: { name: string; trigger: string } | null;
  owner: string | null;
  path: string[];
  selfDuration?: number;
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
  /** Diff hook state and contexts of function components. Default true. */
  trackHooks?: boolean;
  /** Put the current values of every state hook, context and class state on each report (`hookState`, `contexts`, `state`). Default true. */
  includeState?: boolean;
  /**
   * Resolve custom hook names (`useCart › useState#0`) by re-running each reported component type once
   * with a stand-in dispatcher, as React DevTools does. Off by default: the extra render is visible to
   * anything the component does during render (logging, counters). Dev builds only.
   */
  resolveHookNames?: boolean;
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
  /** Skip commits caused by Fast Refresh / hot module replacement. Default true. */
  ignoreHotReload?: boolean;
  /** Stop printing a component after this many reports (0 = unlimited). The notifier still receives them. Default 0. */
  maxReportsPerComponent?: number;
}

/** Marker static: `MyComponent.rerenderLens = true` opts a component in. */
export const MARKER = 'rerenderLens' as const;

export interface TrackableStatics {
  [MARKER]?: boolean;
  displayName?: string;
  name?: string;
}
