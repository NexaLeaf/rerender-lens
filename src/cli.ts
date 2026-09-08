#!/usr/bin/env node
/**
 * rerender-lens CLI: work with panel exports and session files from a terminal or CI.
 *
 *   rerender-lens fixes <export.json>                 ranked fixes for the reports in an export
 *   rerender-lens summary <export.json> [--out s.json] session summary of an export (commit it as a baseline)
 *   rerender-lens compare <before.json> <after.json>   before/after table; exit 1 on regressions
 *   rerender-lens budget <export.json> <budget.json>   check avoidable re-renders per component; exit 1 on violations
 *   rerender-lens budget <export.json> --init          print a budget matching the export
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatFixes } from './fixes';
import { compareSummaries, formatComparison, parseExport, summarizeReports, type SessionSummary } from './sessions';
import { checkBudget, toBudget, type Budget } from './budget';

const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

function summaryOf(file: string): SessionSummary {
  const parsed = parseExport(read(file));
  if (parsed.summary) return parsed.summary;
  if (parsed.sessions.length && !parsed.reports.length) return parsed.sessions[parsed.sessions.length - 1]!;
  return summarizeReports(parsed.reports, { name: file.replace(/^.*[\\/]/, '').replace(/\.json$/, '') });
}

export function main(argv: string[]): number {
  const [cmd, ...args] = argv;
  const flag = (name: string): string | null => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '') : null;
  };
  const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && args[i - 1] !== '--init'));
  try {
    switch (cmd) {
      case 'fixes': {
        const file = positional[0];
        if (!file) throw new Error('usage: rerender-lens fixes <export.json>');
        const { reports } = parseExport(read(file));
        console.log(formatFixes(reports, Number(flag('--limit') || 20)));
        return 0;
      }
      case 'summary': {
        const file = positional[0];
        if (!file) throw new Error('usage: rerender-lens summary <export.json> [--out summary.json]');
        const summary = summaryOf(file);
        const out = flag('--out');
        if (out) {
          writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
          console.log(`${out}: ${summary.total} renders, ${summary.avoidable} avoidable`);
        } else console.log(JSON.stringify(summary, null, 2));
        return 0;
      }
      case 'compare': {
        const [a, b] = positional;
        if (!a || !b) throw new Error('usage: rerender-lens compare <before.json> <after.json>');
        const cmp = compareSummaries(summaryOf(a), summaryOf(b));
        console.log(formatComparison(cmp));
        if (cmp.regressions.length) {
          console.error(`\n${cmp.regressions.length} component${cmp.regressions.length === 1 ? '' : 's'} regressed.`);
          return 1;
        }
        return 0;
      }
      case 'budget': {
        const file = positional[0];
        if (!file) throw new Error('usage: rerender-lens budget <export.json> <budget.json> | --init');
        const { reports } = parseExport(read(file));
        if (args.includes('--init')) {
          console.log(JSON.stringify(toBudget(reports), null, 2));
          return 0;
        }
        const budgetFile = positional[1];
        if (!budgetFile) throw new Error('usage: rerender-lens budget <export.json> <budget.json>');
        const result = checkBudget(reports, read(budgetFile) as Budget);
        if (result.ok) {
          console.log(`Within budget (${Object.keys(result.counts).length} components with avoidable re-renders).`);
          return 0;
        }
        for (const v of result.violations) console.error(`<${v.component}>: ${v.avoidable} avoidable (budget ${v.allowed})`);
        console.error('\n' + formatFixes(reports));
        return 1;
      }
      default:
        console.error('usage: rerender-lens <fixes|summary|compare|budget> ...');
        return cmd ? 1 : 0;
    }
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

const isMain = typeof process !== 'undefined' && Array.isArray(process.argv) && /rerender-lens(\.c?js)?$|cli\.c?js$/.test(process.argv[1] || '');
if (isMain) process.exit(main(process.argv.slice(2)));
