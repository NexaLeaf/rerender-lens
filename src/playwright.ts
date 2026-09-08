/**
 * Playwright helper: run rerender-lens inside any page under test, then pull the reports and assert
 * a budget from the test. Works on production-like builds too (names may be minified there).
 *
 *   import { installRerenderLens, pullReports, expectWithinBudget } from 'rerender-lens/playwright';
 *   await installRerenderLens(page, { trackAllMemoized: true });   // before page.goto
 *   await page.goto('/');
 *   ...interact...
 *   expectWithinBudget(await pullReports(page), { '*': 0, ProductRow: 3 });
 *
 * The library bundle is injected with `page.addInitScript` at document start, exactly like the
 * extension's injection mode, so `init` runs before react-dom.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RenderReport } from './types';
import type { SerializableOptions } from './devtools';
import { assertWithinBudget, checkBudget, type Budget, type BudgetResult } from './budget';
import { rankFixes, formatFixes, type RankedFix } from './fixes';

/** The subset of Playwright's `Page` used here (keeps `@playwright/test` an optional peer). */
export interface PageLike {
  addInitScript(script: string | { content?: string }): Promise<void>;
  evaluate<R>(fn: string | ((arg: unknown) => R), arg?: unknown): Promise<R>;
}

export interface InstallOptions extends SerializableOptions {
  /** Forward to a relay (`npx rerender-lens panel`) to watch the test in the panel. */
  relay?: string;
  /** Print to the page console (default false in tests). */
  silent?: boolean;
}

let bundleCache: string | null = null;

/** The IIFE bundle (`window.RerenderLens`) the extension injects; shipped as `dist/rerender-lens.iife.js`. */
export function libraryBundle(): string {
  if (bundleCache) return bundleCache;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of [join(here, 'rerender-lens.iife.js'), join(here, '..', 'extension', 'vendor', 'rerender-lens.js')]) {
    try {
      bundleCache = readFileSync(file, 'utf8');
      return bundleCache;
    } catch {
      /* next */
    }
  }
  throw new Error('rerender-lens: library bundle not found (run `npm run build` in the rerender-lens repo, or reinstall the package)');
}

/** Script that starts the library with `options` before any page script runs. */
export function installScript(options: InstallOptions = {}): string {
  const { relay, ...rest } = options;
  const opts: InstallOptions = { trackAllMemoized: true, silent: true, ...rest };
  return `${libraryBundle()}\n;(function(){\n  if (window.__RERENDER_LENS_DEVTOOLS__) return;\n  var L = window.RerenderLens;\n  L.ensureDevtoolsHook();\n  var o = ${JSON.stringify(opts)};\n  o.notifier = L.createDevtoolsNotifier(${relay ? JSON.stringify({ relay }) : '{}'});\n  if (o.include) o.include = o.include.map(function (m) { var r = /^\\/(.+)\\/([a-z]*)$/.exec(m); return r ? new RegExp(r[1], r[2]) : m; });\n  if (o.exclude) o.exclude = o.exclude.map(function (m) { var r = /^\\/(.+)\\/([a-z]*)$/.exec(m); return r ? new RegExp(r[1], r[2]) : m; });\n  L.init(o);\n  window.__RERENDER_LENS_PLAYWRIGHT__ = true;\n})();`;
}

/** Call before `page.goto`. */
export async function installRerenderLens(page: PageLike, options: InstallOptions = {}): Promise<void> {
  await page.addInitScript({ content: installScript(options) });
}

/** Every report buffered in the page so far (serialized: functions are `ƒ name`, elements `{ $type: 'element' }`). */
export async function pullReports(page: PageLike): Promise<RenderReport[]> {
  const result = await page.evaluate<{ reports: unknown[] } | null>('(function(){var b=window.__RERENDER_LENS_DEVTOOLS__;return b&&b.pull?b.pull(0):null})()');
  if (!result) throw new Error('rerender-lens is not running in the page: call installRerenderLens(page) before page.goto');
  return result.reports as RenderReport[];
}

/** Drop the page buffer (between scenarios). */
export async function clearReports(page: PageLike): Promise<void> {
  await page.evaluate('(function(){var b=window.__RERENDER_LENS_DEVTOOLS__;if(b)b.clear();})()');
}

export { checkBudget, rankFixes, formatFixes };
export type { Budget, BudgetResult, RankedFix };

/** Throws with the violations and ranked fixes, like `collector.assertWithinBudget`. */
export function expectWithinBudget(reports: RenderReport[], budget: Budget | number): BudgetResult {
  return assertWithinBudget(reports, budget);
}
