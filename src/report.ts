import type { Change, CommitCause, CommitPriority, HookChange, HookSnapshot, Options, ParentInfo, RenderReport, RenderTrigger, ReportLike, SourceLocation } from './types';

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

export interface BuildInput {
  component: string;
  instanceId?: number;
  renderCount: number;
  prevProps: Record<string, unknown>;
  nextProps: Record<string, unknown>;
  propChanges: Change[];
  stateChanges?: Change[];
  hookChanges?: HookChange[];
  hookState?: HookSnapshot[];
  contexts?: { name: string; value: unknown }[];
  state?: Record<string, unknown>;
  parent?: ParentInfo | null;
  owner?: string | null;
  path?: string[];
  /** Default true: `useWhyRerender` and the console output assume the component decides on props alone. */
  memoized?: boolean;
  selfDuration?: number;
  treeDuration?: number;
  commitId?: number;
  commitPriority?: CommitPriority;
  source?: SourceLocation;
  updaters?: string[];
  commitCause?: CommitCause;
  afterCommit?: number;
  key?: string | null;
}

/** `useCart › useState#0` when custom hook names are known, else `useState #0`. */
export const hookLabel = (c: { hook: string; index: number; custom?: string[] }): string =>
  c.custom && c.custom.length ? `${c.custom.join(' › ')} › ${c.hook}#${c.index}` : `${c.hook} #${c.index}`;

/** Store-specific advice for a `useSyncExternalStore` snapshot that is a new reference with equal contents. */
export function storeAdvice(custom: string[] | undefined): string {
  const chain = custom ?? [];
  if (chain.some((n) => /^useSelector$/.test(n)))
    return 'the Redux selector returns a new object on every call: return a stored slice, pass shallowEqual as the equality function, or memoize it with createSelector';
  if (chain.some((n) => /^useAppSelector$/.test(n)))
    return 'the selector returns a new object on every call: return a stored slice, pass shallowEqual, or memoize it with createSelector';
  if (chain.some((n) => /^use[A-Z]\w*Store$/.test(n) || n === 'useStore' || n === 'useBoundStore'))
    return 'the store selector returns a new object on every call: select a primitive, or wrap the selector with useShallow (Zustand) / an equality function';
  return 'getSnapshot returns a new reference with the same contents: cache the snapshot in the store and return the same object while the data is unchanged';
}

const isGenuine = (c: Change): boolean => c.kind === 'different' || c.kind === 'added' || c.kind === 'removed';

/** `children` re-created in the parent's render: the classic memo-defeater, with its own advice. */
const isChildren = (change: Change): boolean => change.path === 'children';

export function fixFor(change: Change): string {
  if (isChildren(change) && (change.kind === 'element' || change.kind === 'deep-equal')) {
    return `lift the children out of the parent's render: memoize them with useMemo, hoist static elements to module scope, or render them from a component that does not re-render`;
  }
  switch (change.kind) {
    case 'function':
      return `wrap it in useCallback (or hoist it out of the parent's render)`;
    case 'element':
      return `memoize the element with useMemo, or pass it as children from a stable parent`;
    case 'deep-equal':
      return Array.isArray(change.next)
        ? `memoize the array with useMemo (same items, new reference)`
        : `memoize the object with useMemo, or hoist it to module scope if it is constant`;
    default:
      return '';
  }
}

function describe(change: Change): string {
  if (isChildren(change) && (change.kind === 'element' || change.kind === 'deep-equal')) {
    return `children are new React elements with the same types and props on every render of the parent`;
  }
  switch (change.kind) {
    case 'deep-equal':
      return `prop "${change.path}" is a new reference but deep-equal to the previous value`;
    case 'function':
      return `prop "${change.path}" is a new function instance on every render`;
    case 'element':
      return `prop "${change.path}" is a new React element with the same type and props`;
    case 'different':
      return `prop "${change.path}" changed`;
    case 'added':
      return `prop "${change.path}" was added`;
    case 'removed':
      return `prop "${change.path}" was removed`;
  }
}

export function buildReport(input: BuildInput): RenderReport {
  const stateChanges = input.stateChanges ?? [];
  const hookChanges = input.hookChanges ?? [];
  const isStateHook = (h: HookChange): boolean => h.hook === 'useState' || h.hook === 'useReducer';
  const genuineProps = input.propChanges.some(isGenuine);
  const genuineState = stateChanges.some(isGenuine) || hookChanges.some((h) => isStateHook(h) && isGenuine(h));
  const genuineHooks = hookChanges.some((h) => !isStateHook(h) && isGenuine(h));
  const causes = [genuineProps && 'props', genuineState && 'state', genuineHooks && 'hooks'].filter(Boolean) as RenderTrigger[];

  let trigger: RenderTrigger;
  if (causes.length === 0) trigger = 'parent';
  else if (causes.length === 1) trigger = causes[0]!;
  else trigger = 'mixed';

  const avoidable = trigger === 'parent';
  const reasons: string[] = [];

  if (avoidable && input.propChanges.length === 0 && stateChanges.length === 0 && hookChanges.length === 0) {
    const who = input.parent ? `<${input.parent.name}> re-rendered (${describeTrigger(input.parent.trigger)})` : 'its parent re-rendered';
    reasons.push(`re-rendered with identical props because ${who}. Wrap "${input.component}" in React.memo (or extend PureComponent).`);
  } else if (avoidable && input.parent) {
    reasons.push(`caused by <${input.parent.name}> re-rendering (${describeTrigger(input.parent.trigger)}).`);
  }
  for (const c of input.propChanges) {
    const fix = fixFor(c);
    reasons.push(fix ? `${describe(c)}: ${fix}.` : `${describe(c)}.`);
  }
  const memoized = input.memoized !== false;
  if (avoidable && !memoized && input.propChanges.length > 0) {
    reasons.push(
      `"${input.component}" is not memoized, so fixing the props alone will not stop this re-render: also wrap it in React.memo (or extend PureComponent).`,
    );
  }
  for (const c of stateChanges) {
    if (isGenuine(c)) reasons.push(`state "${c.path}" changed.`);
    else reasons.push(`setState was called with a value deep-equal to the current "${c.path}" (new reference, same contents).`);
  }
  for (const c of hookChanges) {
    if (c.hook === 'useContext' && isGenuine(c)) {
      const where = c.provider && c.provider.component ? ` (provided by <${c.provider.component}>)` : '';
      const keys =
        c.changedKeys && typeof c.totalKeys === 'number' && c.changedKeys.length > 0 && c.changedKeys.length < c.totalKeys
          ? `: only ${c.changedKeys.map((k) => `"${k}"`).join(', ')} of ${c.totalKeys} keys changed, yet every consumer re-renders. Split the context or memoize the slices consumers read`
          : '';
      reasons.push(`${c.path} changed${where}${keys}.`);
    } else if (isGenuine(c)) reasons.push(`${hookLabel(c)} changed.`);
    else if (isStateHook(c))
      reasons.push(`${hookLabel(c)} was set to a value deep-equal to the current one (new reference, same contents): reuse the existing object or bail out before calling the setter.`);
    else if (c.hook === 'useSyncExternalStore') reasons.push(`${hookLabel(c)} returned a new reference that is deep-equal to the previous value: ${storeAdvice(c.custom)}.`);
    else reasons.push(`${hookLabel(c)} returned a new reference that is deep-equal to the previous value: memoize the context/store value where it is produced.`);
  }
  if (input.commitCause === 'effect-after-commit') {
    const who = input.updaters && input.updaters.length ? input.updaters.map((u) => `<${u}>`).join(', ') : 'a component that rendered in it';
    reasons.push(`this commit was scheduled right after commit #${input.afterCommit ?? '?'} by ${who}: an effect there set state (effect → setState loop). Derive the value during render or compute it before setting state.`);
  } else if (input.commitCause === 'suspense-resolved') {
    reasons.push('this commit shows content that was suspended (a Suspense boundary resolved).');
  }

  const report: RenderReport = {
    component: input.component,
    instanceId: input.instanceId ?? 0,
    commitId: input.commitId ?? 0,
    renderCount: input.renderCount,
    trigger,
    avoidable,
    memoized,
    props: { prev: input.prevProps, next: input.nextProps },
    propChanges: input.propChanges,
    stateChanges,
    hookChanges,
    parent: input.parent ?? null,
    owner: input.owner ?? null,
    path: input.path ?? [],
    reasons,
    time: now(),
  };
  if (input.selfDuration !== undefined) report.selfDuration = input.selfDuration;
  if (input.treeDuration !== undefined) report.treeDuration = input.treeDuration;
  if (input.commitPriority) report.commitPriority = input.commitPriority;
  if (input.source) report.source = input.source;
  if (input.hookState) report.hookState = input.hookState;
  if (input.contexts) report.contexts = input.contexts;
  if (input.state) report.state = input.state;
  if (input.updaters && input.updaters.length) report.updaters = input.updaters;
  if (input.commitCause) report.commitCause = input.commitCause;
  if (input.afterCommit !== undefined) report.afterCommit = input.afterCommit;
  if (input.key !== undefined) report.key = input.key;
  return report;
}

function describeTrigger(t: RenderTrigger): string {
  switch (t) {
    case 'props':
      return 'its props changed';
    case 'state':
      return 'its state changed';
    case 'hooks':
      return 'a context or store it reads changed';
    case 'mixed':
      return 'its props and state changed';
    default:
      return 'its own parent re-rendered';
  }
}

/** Short label per change kind, as printed by the console output and the panel. */
export const KIND_LABEL: Record<Change['kind'], string> = {
  'deep-equal': 'equal by value',
  function: 'new function',
  element: 'equal element',
  different: 'changed',
  added: 'added',
  removed: 'removed',
};

/** `1 equal by value, 2 new function`, or `no changes`. Shared with the panel (serialized reports). */
export function summarize(report: Pick<ReportLike, 'propChanges' | 'stateChanges' | 'hookChanges'>): string {
  const counts = new Map<string, number>();
  for (const c of [...(report.propChanges || []), ...(report.stateChanges || []), ...(report.hookChanges || [])]) {
    counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, n]) => `${n} ${KIND_LABEL[kind as Change['kind']] || kind}`);
  if (parts.length === 0) parts.push('no changes');
  return parts.join(', ');
}

/** Default notifier: prints a console group per report. */
export function printReport(report: RenderReport, options: Options): void {
  const c = options.console ?? console;
  const open = options.collapse === false ? c.group : c.groupCollapsed;
  const verdict = report.avoidable ? 'avoidable re-render' : `re-render (${report.trigger})`;
  open.call(c, `[rerender-lens] <${report.component}> ${verdict}: ${summarize(report)}`);
  for (const r of report.reasons) c.log(`- ${r}`);
  if (report.path.length) c.log(`at ${[...report.path, report.component].join(' > ')}`);
  for (const ch of [...report.propChanges, ...report.stateChanges, ...report.hookChanges]) {
    c.log(`${ch.path} (${KIND_LABEL[ch.kind]})`, { prev: ch.prev, next: ch.next });
  }
  c.log('props', report.props);
  if (report.hookState && report.hookState.length) c.log('hooks', Object.fromEntries(report.hookState.map((h) => [h.path, h.value])));
  if (report.contexts && report.contexts.length) c.log('contexts', Object.fromEntries(report.contexts.map((x) => [x.name, x.value])));
  if (report.state) c.log('state', report.state);
  c.groupEnd();
}
