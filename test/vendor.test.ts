import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RenderReport } from '../src/types';
import { h, mount } from './helpers';

const vendor = join(__dirname, '..', 'extension', 'vendor');
const PARTS = ['rerender-lens.core.js', 'rerender-lens.engine.js', 'rerender-lens.js'];
const built = PARTS.every((f) => existsSync(join(vendor, f)));

interface Lib {
  VERSION: string;
  init(o: object): () => void;
  ensureDevtoolsHook(): unknown;
  createDevtoolsNotifier(o?: object): (r: RenderReport) => void;
  isEnabled(): boolean;
}
const w = window as unknown as { RerenderLens?: Lib; __RERENDER_LENS_PARTS__?: Record<string, unknown>; __RERENDER_LENS_DEVTOOLS__?: unknown };
const load = (file: string): void => new Function(readFileSync(join(vendor, file), 'utf8'))();

// The vendor scripts are build outputs (`npm run build`); nothing to check before that.
describe.skipIf(!built)('vendor scripts (extension/vendor, built by scripts/build-vendor.mjs)', () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
    delete w.RerenderLens;
    delete w.__RERENDER_LENS_PARTS__;
  });

  it('the bridge part refuses to load without the earlier parts', () => {
    expect(() => load('rerender-lens.js')).toThrow(/load vendor\/rerender-lens.core.js and vendor\/rerender-lens.engine.js before/);
  });

  it('loaded in order they define window.RerenderLens, share one copy of each module, and report a re-render', () => {
    for (const f of PARTS) load(f);
    const L = w.RerenderLens!;
    expect(L.VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.keys(w.__RERENDER_LENS_PARTS__!).sort()).toEqual(['diff', 'fiber', 'hookNames', 'overlay', 'report', 'state', 'tracker', 'types', 'version']);
    const seen: RenderReport[] = [];
    L.ensureDevtoolsHook();
    stop = L.init({ trackAllMemoized: true, silent: true, notifier: (r: RenderReport) => seen.push(r) });
    expect(L.isEnabled()).toBe(true);
    let bump: () => void = () => {};
    const Child = React.memo(function Child(p: { style: object }) {
      return h('span', p.style && null, 'x');
    });
    function Parent() {
      const [n, setN] = React.useState(0);
      bump = () => setN(n + 1);
      return h(Child, { style: { n } });
    }
    const hn = mount(h(Parent));
    React.act(bump);
    hn.unmount();
    expect(seen.map((r) => r.component)).toEqual(['Child']);
    expect(seen[0]!.propChanges[0]!.path).toMatch(/^style/);
  });
});
