import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import {
  combineNotifiers,
  configure,
  createCollector,
  createDevtoolsNotifier,
  deserializeOptions,
  disable,
  getRenderers,
  init,
  isProductionReact,
  serialize,
  serializeOptions,
  track,
  PROTOCOL_VERSION,
  VERSION,
  type HelloPayload,
} from '../src/index';
import { durationsOf, ensureDevtoolsHook, parseStackLocation, priorityLabel, sourceOf, type Fiber } from '../src/fiber';
import { h, mount } from './helpers';
import { act } from './react-act';
import { HAS_CONTEXT_VALUES } from './react-version';

afterEach(() => {
  disable();
  document.getElementById('rerender-lens-overlay')?.remove();
});

function makeParent(child: (n: number) => React.ReactElement) {
  let bump: () => void = () => {};
  function Parent() {
    const [n, setN] = React.useState(0);
    bump = () => setN((x) => x + 1);
    return child(n);
  }
  return { Parent, rerender: () => act(bump) };
}

describe('commit ids and source', () => {
  it('stamps every report of one commit with the same commitId and increments per commit', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true });
    const A = track((p: { n: number }) => h('span', null, p.n), 'A');
    const B = track((p: { n: number }) => h('span', null, p.n), 'B');
    const { Parent, rerender } = makeParent(() => h('div', null, h(A, { n: 1 }), h(B, { n: 1 })));
    const hn = mount(h(Parent));
    rerender();
    rerender();
    const ids = collector.reports.map((r) => r.commitId);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[2]).toBe(ids[0]! + 1);
    hn.unmount();
  });

  it('parses React 19 debug stacks and reads React 18 _debugSource', () => {
    const stack = [
      'Error',
      '    at exports.jsxDEV (http://localhost:5199/node_modules/.vite/deps/react_jsx-dev-runtime.js:200:20)',
      '    at App (http://localhost:5199/src/App.tsx?t=1:52:36)',
      '    at renderWithHooks (http://localhost:5199/node_modules/.vite/deps/react-dom_client.js:4200:11)',
    ].join('\n');
    expect(parseStackLocation(stack)).toEqual({ fileName: 'http://localhost:5199/src/App.tsx?t=1', lineNumber: 52, columnNumber: 36 });
    // Firefox-style frames
    expect(parseStackLocation('App@http://localhost:5199/src/App.tsx:10:5')).toEqual({ fileName: 'http://localhost:5199/src/App.tsx', lineNumber: 10, columnNumber: 5 });
    expect(parseStackLocation('no frames here')).toBeUndefined();
    const f18 = { _debugSource: { fileName: '/src/Row.tsx', lineNumber: 7, columnNumber: 3 } } as unknown as Fiber;
    expect(sourceOf(f18)).toEqual({ fileName: '/src/Row.tsx', lineNumber: 7, columnNumber: 3 });
    const f19 = { _debugStack: { stack } } as unknown as Fiber;
    expect(sourceOf(f19)?.lineNumber).toBe(52);
  });

  it('exposes the renderers react-dom injected', () => {
    ensureDevtoolsHook();
    const renderers = getRenderers();
    expect(renderers.length).toBeGreaterThan(0);
    expect(renderers[0]!.version).toMatch(/^\d+\./);
    expect(renderers[0]!.bundleType).toBe(1); // dev build in tests
    expect(isProductionReact()).toBe(false);
  });

  it('captures renderers through hook.inject when the hook does not store them (react-refresh style)', () => {
    const hook = ensureDevtoolsHook();
    const before = getRenderers().length;
    init({ silent: true }); // wraps inject
    // A refresh-style hook returns an id without touching `renderers`.
    const stub = { renderers: new Map(), inject: () => 42 };
    const wrapped = hook.inject;
    wrapped.call(stub, { version: '18.3.1', bundleType: 0, rendererPackageName: 'react-dom' });
    const renderers = getRenderers();
    expect(renderers.length).toBe(before + 1);
    expect(renderers.some((r) => r.version === '18.3.1' && r.bundleType === 0)).toBe(true);
  });
});

describe('memoized flag and timing', () => {
  it('marks memo / PureComponent as memoized and plain components as not, and explains the memo fix', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, trackAllMemoized: true, include: ['Plain'] });
    const Plain = (p: { style: object }) => h('span', null, JSON.stringify(p.style));
    const Memo = React.memo(function Memo(p: { style: object }) {
      return h('span', null, JSON.stringify(p.style));
    });
    class Pure extends React.PureComponent<{ style: object }> {
      override render() {
        return h('span', null, JSON.stringify(this.props.style));
      }
    }
    const { Parent, rerender } = makeParent(() => h('div', null, h(Plain, { style: { a: 1 } }), h(Memo, { style: { a: 1 } }), h(Pure, { style: { a: 1 } })));
    const hn = mount(h(Parent));
    rerender();
    const byName = new Map(collector.reports.map((r) => [r.component, r]));
    expect(byName.get('Plain')!.memoized).toBe(false);
    expect(byName.get('Memo')!.memoized).toBe(true);
    expect(byName.get('Pure')!.memoized).toBe(true);
    expect(byName.get('Plain')!.reasons.some((x) => /not memoized.*React\.memo/.test(x))).toBe(true);
    expect(byName.get('Memo')!.reasons.some((x) => /not memoized/.test(x))).toBe(false);
    hn.unmount();
  });

  it('reports self time without the children and the subtree time separately', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true });
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const Outer = track((p: { n: number }) => h('div', null, h(Child, { n: p.n })), 'Outer');
    const { Parent, rerender } = makeParent(() => h(Outer, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    const outer = collector.reports.find((r) => r.component === 'Outer')!;
    const child = collector.reports.find((r) => r.component === 'Child')!;
    // React's dev build records actualDuration; in a profiling build these are real numbers.
    if (typeof outer.treeDuration === 'number') {
      expect(outer.selfDuration).toBeGreaterThanOrEqual(0);
      expect(outer.treeDuration).toBeGreaterThanOrEqual(outer.selfDuration!);
      expect(outer.treeDuration).toBeGreaterThanOrEqual(child.treeDuration ?? 0);
    } else {
      expect(outer.selfDuration).toBeUndefined();
    }
    hn.unmount();
  });

  it('synthetic fibers: self time subtracts direct children only', () => {
    const child = { actualDuration: 2, child: null, sibling: null } as unknown as Fiber;
    const child2 = { actualDuration: 3, child: null, sibling: null } as unknown as Fiber;
    (child as { sibling: Fiber | null }).sibling = child2;
    const f = { actualDuration: 10, child } as unknown as Fiber;
    expect(durationsOf(f)).toEqual({ self: 5, tree: 10 });
    expect(durationsOf({ actualDuration: 1, child: { actualDuration: 4, sibling: null } } as unknown as Fiber)).toEqual({ self: 0, tree: 1 });
    expect(durationsOf({} as Fiber)).toBeNull();
  });
});

describe('state snapshots', () => {
  it.skipIf(!HAS_CONTEXT_VALUES)('puts every state hook, context and class state on the report, and includeState:false turns it off', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true });
    const Theme = React.createContext('light');
    Theme.displayName = 'Theme';
    const Fn = track(function Fn(p: { n: number }) {
      const [a] = React.useState('a');
      React.useEffect(() => {}, []);
      const [b, dispatch] = React.useReducer((s: number) => s + 1, 0);
      const t = React.useContext(Theme);
      React.useEffect(() => {
        if (p.n === 1) dispatch();
      }, [p.n]);
      return h('span', null, a + b + t);
    }, 'Fn');
    class Cls extends React.Component<{ n: number }, { count: number; label: string }> {
      override state = { count: 0, label: 'x' };
      override render() {
        return h('span', null, this.state.count + this.props.n);
      }
    }
    track(Cls);
    const { Parent, rerender } = makeParent((n) => h('div', null, h(Fn, { n: n + 1 }), h(Cls, { n })));
    const hn = mount(h(Parent));
    rerender();
    const fn = collector.reports.find((r) => r.component === 'Fn')!;
    expect(fn.hookState!.map((x) => [x.path, x.value])).toEqual([
      ['useState#0', 'a'],
      ['useReducer#2', 1],
    ]);
    expect(fn.contexts).toEqual([{ name: 'Theme', value: 'light' }]);
    expect(fn.state).toBeUndefined();
    const cls = collector.reports.find((r) => r.component === 'Cls')!;
    expect(cls.state).toEqual({ count: 0, label: 'x' });
    expect(cls.hookState).toEqual([]);
    configure({ includeState: false });
    rerender();
    const later = collector.reports.filter((r) => r.component === 'Fn').at(-1)!;
    expect(later.hookState).toBeUndefined();
    expect(later.contexts).toBeUndefined();
    hn.unmount();
  });
});

describe('context providers, children and commit priority', () => {
  it.skipIf(!HAS_CONTEXT_VALUES)('attributes a context change to the component rendering its Provider and lists the changed keys', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true });
    const Theme = React.createContext<{ mode: string; user: string }>({ mode: 'light', user: 'a' });
    Theme.displayName = 'Theme';
    const Consumer = track(function Consumer() {
      const t = React.useContext(Theme);
      return h('span', null, t.mode);
    }, 'Consumer');
    function Shell(p: { children: React.ReactNode }) {
      return h('section', null, p.children);
    }
    let setMode: (m: string) => void = () => {};
    function Root() {
      const [mode, set] = React.useState('light');
      setMode = set;
      // new object every render: only `mode` changes, `user` stays
      return h(Theme.Provider, { value: { mode, user: 'a' } }, h(Shell, null, h(Consumer)));
    }
    const hn = mount(h(Root));
    act(() => setMode('dark'));
    const r = collector.reports.find((x) => x.component === 'Consumer')!;
    const ctx = r.hookChanges.find((c) => c.hook === 'useContext')!;
    expect(ctx.provider).toEqual({ component: 'Root', path: ['Root'] });
    expect(ctx.changedKeys).toEqual(['mode']);
    expect(ctx.totalKeys).toBe(2);
    expect(r.reasons.some((x) => /useContext\(Theme\) changed \(provided by <Root>\): only "mode" of 2 keys changed/.test(x))).toBe(true);
    hn.unmount();
  });

  it('explains re-created children and serializes elements with their props', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true, trackAllMemoized: true });
    const Box = React.memo(function Box(p: { children: React.ReactNode }) {
      return h('div', null, p.children);
    });
    Box.displayName = 'Box';
    const { Parent, rerender } = makeParent(() => h(Box, null, h('em', { className: 'x' }, 'hi'), h('b', null, 'there')));
    const hn = mount(h(Parent));
    rerender();
    const r = collector.reports.find((x) => x.component === 'Box')!;
    expect(r.avoidable).toBe(true);
    expect(r.propChanges[0]!.path).toBe('children');
    expect(r.reasons.some((x) => /children are new React elements.*lift the children out of the parent's render/.test(x))).toBe(true);
    const s = serialize(r.propChanges[0]!.next) as { $type: string; name: string; props: { className: string } }[];
    expect(s[0]).toMatchObject({ $type: 'element', name: 'em', props: { className: 'x', children: 'hi' } });
    hn.unmount();
  });

  it('labels the commit priority and counts scheduled roots vs commits', () => {
    const collector = createCollector();
    init({ notifier: collector.notifier, silent: true });
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    const r = collector.reports[0]!;
    // act() flushes with the default scheduler priority; any label is fine, but it must be a known one
    expect([undefined, 'immediate', 'user-blocking', 'normal', 'low', 'idle']).toContain(r.commitPriority);
    expect(priorityLabel(1)).toBe('immediate');
    expect(priorityLabel(3)).toBe('normal');
    expect(priorityLabel(99)).toBeUndefined();
    const notify = createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window });
    notify(r);
    const info = window.__RERENDER_LENS_DEVTOOLS__!.info();
    expect(info.commits).toBeGreaterThan(0);
    expect(info.scheduled).toBeGreaterThanOrEqual(0);
    hn.unmount();
  });
});

describe('broadcast channel', () => {
  it('publishes reports on the channel and answers commands; info() carries the overhead', async () => {
    const collector = createCollector();
    // listen before init: the notifier says hello as soon as it is created
    const listener = new BroadcastChannel('rl-test');
    const received: { type: string; payload?: unknown }[] = [];
    listener.onmessage = (e: MessageEvent) => {
      if (e.data && e.data.__rerenderLens) received.push({ type: e.data.type, payload: e.data.payload });
    };
    init({ notifier: combineNotifiers(collector.notifier, createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window, channel: 'rl-test' })), silent: true });
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(received.map((m) => m.type)).toEqual(['hello', 'report']);
    expect((received[1]!.payload as { component: string }).component).toBe('Child');

    const ask = (cmd: string, arg?: unknown): Promise<unknown> =>
      new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        const onReply = (e: MessageEvent): void => {
          if (e.data && e.data.__rerenderLensReply && e.data.id === id) {
            listener.removeEventListener('message', onReply);
            resolve(e.data.error ? new Error(e.data.error) : e.data.result);
          }
        };
        listener.addEventListener('message', onReply);
        listener.postMessage({ __rerenderLensCmd: true, id, cmd, arg });
      });
    const info = (await ask('info')) as HelloPayload;
    expect(info.count).toBe(1);
    expect(info.overhead.totalMs).toBeGreaterThanOrEqual(0);
    expect(info.overhead.maxCommitMs).toBeGreaterThanOrEqual(0);
    expect(info.commits).toBeGreaterThan(0);
    const pulled = (await ask('pull', 0)) as { reports: unknown[] };
    expect(pulled.reports).toHaveLength(1);
    expect(await ask('configure', { include: ['X'] })).toMatchObject({ include: ['X'] });
    expect(await ask('nope')).toBeInstanceOf(Error);
    received.length = 0;
    expect(await ask('replay')).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(received.map((m) => m.type)).toEqual(['hello', 'report']);
    expect(await ask('clear')).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(received.at(-1)!.type).toBe('clear');
    listener.close();
    hn.unmount();
  });
});

describe('options round-trip', () => {
  it('serializes matchers as strings and back', () => {
    const s = serializeOptions({ trackAllMemoized: true, include: [/^Grid/i, 'Sidebar', () => true], maxReportsPerComponent: 3 });
    expect(s).toEqual({ trackAllMemoized: true, include: ['/^Grid/i', 'Sidebar'], maxReportsPerComponent: 3 });
    const o = deserializeOptions(s);
    expect(o.include![0]).toBeInstanceOf(RegExp);
    expect((o.include![0] as RegExp).flags).toBe('i');
    expect(o.include![1]).toBe('Sidebar');
    expect(deserializeOptions({ include: ['/(/'] }).include).toEqual(['/(/']);
  });
});

describe('bridge v2', () => {
  it('hello carries library, protocol, react and options; pull() is cursor based', () => {
    const postMessage = vi.fn();
    init({ silent: true, trackAllMemoized: true, notifier: createDevtoolsNotifier({ target: { postMessage } as unknown as Window, bufferSize: 3 }) });
    const hello = postMessage.mock.calls[0]![0] as { version: number; payload: HelloPayload };
    expect(hello.version).toBe(PROTOCOL_VERSION);
    expect(hello.payload.library).toBe(VERSION);
    expect(hello.payload.protocol).toBe(PROTOCOL_VERSION);
    expect(hello.payload.production).toBe(false);

    const bridge = window.__RERENDER_LENS_DEVTOOLS__!;
    // hello is posted while the notifier is created, before init() stores the options; info() sees them.
    expect(bridge.info().options).toEqual({ trackAllMemoized: true, silent: true });
    expect(bridge.info().enabled).toBe(true);
    expect(bridge.info().source).toBe('page');
    expect(bridge.info().injected).toBe(false);
    // An injected copy marks the window; a page-created bridge then reports both facts.
    window.__RERENDER_LENS_INJECTED__ = '0.2.0';
    expect(bridge.info().injected).toBe(true);
    delete window.__RERENDER_LENS_INJECTED__;
    createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window, source: 'extension' });
    expect(window.__RERENDER_LENS_DEVTOOLS__!.info().source).toBe('extension');
    const Child = track((p: { n: number }) => h('span', null, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h(Child, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    rerender();
    let pulled = bridge.pull();
    expect(pulled.reports).toHaveLength(2);
    expect(pulled.dropped).toBe(false);
    const cursor = pulled.seq;
    rerender();
    pulled = bridge.pull(cursor);
    expect(pulled.reports).toHaveLength(1);
    expect(bridge.pull(pulled.seq).reports).toHaveLength(0);
    // overflow: buffer keeps 3, so a stale cursor reports dropped
    rerender();
    rerender();
    rerender();
    expect(bridge.pull(1).dropped).toBe(true);
    expect(bridge.info().count).toBe(3);
    hn.unmount();
  });

  it('configure() applies serialized options live and getOptions reflects them', () => {
    const collector = createCollector();
    init({ silent: true, notifier: combineNotifiers(collector.notifier, createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window })) });
    const bridge = window.__RERENDER_LENS_DEVTOOLS__!;
    const Plain = (p: { n: number }) => h('span', null, p.n);
    const { Parent, rerender } = makeParent(() => h(Plain, { n: 1 }));
    const hn = mount(h(Parent));
    rerender();
    expect(collector.reports).toHaveLength(0);
    expect(bridge.configure({ include: ['/^Pla/'] })).toEqual({ silent: true, include: ['/^Pla/'] });
    rerender();
    expect(collector.reports).toHaveLength(1);
    expect(bridge.getOptions().include).toEqual(['/^Pla/']);
    hn.unmount();
  });

  it('info().tracking says what is covered; inspect() and explain() carry the verdict', () => {
    init({ silent: true, trackAllMemoized: true, exclude: ['Ignored'], notifier: createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window }) });
    const bridge = window.__RERENDER_LENS_DEVTOOLS__!;
    const Plain = (p: { n: number }) => h('span', { className: 'plain' }, p.n);
    Object.defineProperty(Plain, 'name', { value: 'Plain' });
    const Memoed = React.memo((p: { n: number }) => h('i', { className: 'memoed' }, p.n));
    (Memoed as { displayName?: string }).displayName = 'Memoed';
    const { Parent, rerender } = makeParent((n) => h('div', null, h(Plain, { n: 1 }), h(Memoed, { n })));
    const hn = mount(h(Parent));
    rerender();

    const t = bridge.info().tracking;
    expect(t.mode).toBe('memoized');
    expect(t.exclude).toEqual(['Ignored']);
    expect(t.include).toEqual([]);
    expect(t.overflow).toBe(false);
    // Parent, Plain and Memoed rendered; only the memo one is tracked.
    expect(t.renderedCount).toBe(3);
    expect(t.trackedCount).toBe(1);

    const span = hn.container.querySelector('.plain')!;
    const inspected = bridge.inspect(span)!;
    expect(inspected.tracked).toBe(false);
    expect(inspected.tracking.tracked).toBe(false);
    expect(inspected.tracking.name).toBe('Plain');
    expect(inspected.tracking.reason).toContain('only covers React.memo');
    expect(inspected.tracking.fix).toContain('Add "Plain" to include');
    // explain() takes a DOM node, or an instance id (all a relay/channel panel can send)
    expect(bridge.explain(span)!.name).toBe('Plain');
    const id = (bridge.pull().reports[0] as { instanceId: number }).instanceId;
    expect(bridge.explain(id)).toMatchObject({ tracked: true, name: 'Memoed', memoized: true });
    expect(bridge.explain(document.body)).toBeNull();
    expect(bridge.explain(999999)).toBeNull();

    // the panel's one-click fixes, through the same configure() path
    bridge.configure({ include: ['Plain'] });
    expect(bridge.info().tracking.include).toEqual(['Plain']);
    expect(bridge.explain(span)).toMatchObject({ tracked: true, reason: '<Plain> matches "include".' });
    bridge.configure({ trackAllComponents: true });
    expect(bridge.info().tracking.mode).toBe('all');
    rerender();
    expect(bridge.info().tracking.trackedCount).toBe(3);
    hn.unmount();
  });

  it('highlight() outlines the DOM of an instance and inspect() resolves a DOM node', () => {
    init({ silent: true, notifier: createDevtoolsNotifier({ target: { postMessage() {} } as unknown as Window }) });
    const bridge = window.__RERENDER_LENS_DEVTOOLS__!;
    const Child = track((p: { n: number }) => h('span', { className: 'child' }, p.n), 'Child');
    const { Parent, rerender } = makeParent(() => h('div', null, h(Child, { n: 1 })));
    const hn = mount(h(Parent));
    const span = hn.container.querySelector('.child')!;
    // Not reported yet: nearest component is known, instance id is not.
    let info = bridge.inspect(span)!;
    expect(info.component).toBe('Child');
    expect(info.instanceId).toBeNull();
    expect(info.tracked).toBe(true);
    expect(info.path).toEqual(['Parent']);
    rerender();
    info = bridge.inspect(span)!;
    const id = (bridge.pull().reports[0] as { instanceId: number }).instanceId;
    expect(info.instanceId).toBe(id);
    expect(info.reports).toHaveLength(1);
    expect(bridge.inspect(document.body)).toBeNull();

    // jsdom has no layout; make the node report a size
    span.getBoundingClientRect = () => ({ left: 5, top: 5, width: 40, height: 20, right: 45, bottom: 25, x: 5, y: 5, toJSON() {} }) as DOMRect;
    expect(bridge.highlight(id)).toBe(true);
    const overlay = document.getElementById('rerender-lens-overlay')!;
    expect(overlay.children).toHaveLength(1);
    expect(overlay.textContent).toBe('Child');
    expect(bridge.highlight(999999)).toBe(false);
    expect(overlay.children).toHaveLength(0);
    bridge.highlight(id);
    bridge.highlight(null);
    expect(overlay.children).toHaveLength(0);

    // flash on avoidable render
    bridge.flashAvoidable(true);
    rerender();
    expect(overlay.children.length).toBe(1);
    hn.unmount();
  });
});
