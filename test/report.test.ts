import { describe, expect, it } from 'vitest';
import { buildReport, printReport, summarize } from '../src/report';
import { silentConsole } from './helpers';

const base = { component: 'X', renderCount: 1, prevProps: {}, nextProps: {} };

describe('buildReport', () => {
  it('flags an identical-props re-render as parent/avoidable with a memo hint', () => {
    const r = buildReport({ ...base, propChanges: [] });
    expect(r.trigger).toBe('parent');
    expect(r.avoidable).toBe(true);
    expect(r.reasons[0]).toMatch(/React\.memo/);
  });
  it('treats deep-equal, function and element changes as avoidable', () => {
    const r = buildReport({
      ...base,
      propChanges: [
        { path: 'style', kind: 'deep-equal', prev: {}, next: {} },
        { path: 'onClick', kind: 'function', prev: () => 1, next: () => 1 },
        { path: 'icon', kind: 'element', prev: null, next: null },
      ],
    });
    expect(r.avoidable).toBe(true);
    expect(r.trigger).toBe('parent');
    expect(r.reasons.join('\n')).toMatch(/useMemo/);
    expect(r.reasons.join('\n')).toMatch(/useCallback/);
    expect(summarize(r)).toBe('1 equal by value, 1 new function, 1 equal element');
  });
  it('is not avoidable when a prop genuinely changed', () => {
    const r = buildReport({ ...base, propChanges: [{ path: 'n', kind: 'different', prev: 1, next: 2 }] });
    expect(r.avoidable).toBe(false);
    expect(r.trigger).toBe('props');
  });
  it('maps useState changes to "state" and useContext to "hooks", mixing when both', () => {
    const s = buildReport({
      ...base,
      propChanges: [],
      hookChanges: [{ path: 'useState#0', hook: 'useState', index: 0, kind: 'different', prev: 1, next: 2 }],
    });
    expect(s.trigger).toBe('state');
    const hk = buildReport({
      ...base,
      propChanges: [],
      hookChanges: [{ path: 'useContext#0', hook: 'useContext', index: 0, kind: 'different', prev: 1, next: 2 }],
    });
    expect(hk.trigger).toBe('hooks');
    const m = buildReport({
      ...base,
      propChanges: [{ path: 'n', kind: 'different', prev: 1, next: 2 }],
      stateChanges: [{ path: 'open', kind: 'different', prev: false, next: true }],
    });
    expect(m.trigger).toBe('mixed');
  });
  it('flags a deep-equal setState as avoidable', () => {
    const r = buildReport({ ...base, propChanges: [], stateChanges: [{ path: 'items', kind: 'deep-equal', prev: [1], next: [1] }] });
    expect(r.avoidable).toBe(true);
    expect(r.reasons[0]).toMatch(/deep-equal/);
  });
});

describe('printReport', () => {
  it('prints a collapsed group by default and an open group when collapse=false', () => {
    const r = buildReport({ ...base, propChanges: [] });
    const a = silentConsole();
    printReport(r, { console: a.console });
    expect(a.calls[0]).toMatch(/^group \[rerender-lens\] <X> avoidable re-render: no changes/);
    expect(a.calls.at(-1)).toBe('groupEnd');
    const b = silentConsole();
    let opened = '';
    b.console.group = (...args: unknown[]) => void (opened = String(args[0]));
    printReport(r, { console: b.console, collapse: false });
    expect(opened).toMatch(/avoidable/);
  });
});
