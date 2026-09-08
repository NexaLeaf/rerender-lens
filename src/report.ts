import type { Change, HookChange, Options, ParentInfo, RenderReport, RenderTrigger, SourceLocation } from './types';

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
  parent?: ParentInfo | null;
  owner?: string | null;
  path?: string[];
  selfDuration?: number;
  commitId?: number;
  source?: SourceLocation;
}

const isGenuine = (c: Change): boolean => c.kind === 'different' || c.kind === 'added' || c.kind === 'removed';

export function fixFor(change: Change): string {
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
  for (const c of stateChanges) {
    if (isGenuine(c)) reasons.push(`state "${c.path}" changed.`);
    else reasons.push(`setState was called with a value deep-equal to the current "${c.path}" (new reference, same contents).`);
  }
  for (const c of hookChanges) {
    if (isGenuine(c)) reasons.push(`${c.hook} #${c.index} changed.`);
    else if (isStateHook(c))
      reasons.push(`${c.hook} #${c.index} was set to a value deep-equal to the current one (new reference, same contents): reuse the existing object or bail out before calling the setter.`);
    else reasons.push(`${c.hook} #${c.index} returned a new reference that is deep-equal to the previous value: memoize the context/store value where it is produced.`);
  }

  const report: RenderReport = {
    component: input.component,
    instanceId: input.instanceId ?? 0,
    commitId: input.commitId ?? 0,
    renderCount: input.renderCount,
    trigger,
    avoidable,
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
  if (input.source) report.source = input.source;
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

const KIND_LABEL: Record<Change['kind'], string> = {
  'deep-equal': 'equal by value',
  function: 'new function',
  element: 'equal element',
  different: 'changed',
  added: 'added',
  removed: 'removed',
};

export function summarize(report: RenderReport): string {
  const counts = new Map<string, number>();
  for (const c of [...report.propChanges, ...report.stateChanges, ...report.hookChanges]) {
    counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, n]) => `${n} ${KIND_LABEL[kind as Change['kind']]}`);
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
  c.groupEnd();
}
