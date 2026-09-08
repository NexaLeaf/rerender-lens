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
}

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
  /** Nearest ancestor that rendered in the same commit, or null when the update started here. */
  parent: ParentInfo | null;
  /** Component that created this element (dev builds only). */
  owner: string | null;
  /** Component ancestry from the root down to this component, display names only. */
  path: string[];
  /** Render time of this component in ms, when React exposes it (dev/profiling builds). */
  selfDuration?: number;
  /** Source location of the element that rendered this component, when React exposes it (dev builds). */
  source?: SourceLocation;
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
  /** Diff hook state and contexts of function components. Default true. */
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
