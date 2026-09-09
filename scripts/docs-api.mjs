// The API reference for the docs site, read from the sources with the TypeScript compiler that is
// already a devDependency (no documentation toolchain, and the same design as the rest of the site).
// `buildApi()` returns one section per public entry point; `scripts/build-docs.mjs` renders it.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Public entry points, in the order the docs list them. `blurb` is the one-liner under the heading. */
export const ENTRIES = [
  { specifier: 'rerender-lens', file: 'src/index.ts', blurb: 'The library: start it, mark components, collect reports, rank fixes and root causes.' },
  { specifier: 'rerender-lens/vite', file: 'src/vite.ts', blurb: 'The Vite plugin: start the library before React in dev, and serve the panel.' },
  { specifier: 'rerender-lens/setup', file: 'src/setup.ts', blurb: 'A side-effect entry for Next.js and Webpack: import it first and the library starts with sensible defaults.' },
  { specifier: 'rerender-lens/relay', file: 'src/relay.ts', blurb: 'The relay behind `rerender-lens panel`: serves the panel and forwards messages between apps and panels.' },
  { specifier: 'rerender-lens/vitest', file: 'src/vitest.ts', blurb: 'Vitest: collect every avoidable re-render across a run and fail on a budget.' },
  { specifier: 'rerender-lens/jest', file: 'src/jest.ts', blurb: 'Jest: the same, with a Jest reporter.' },
  { specifier: 'rerender-lens/playwright', file: 'src/playwright.ts', blurb: 'Playwright: run the library inside a real browser under test.' },
];

const KIND_ORDER = ['function', 'class', 'const', 'interface', 'type', 'enum'];

function kindOf(symbol) {
  const f = symbol.flags;
  if (f & ts.SymbolFlags.Function) return 'function';
  if (f & ts.SymbolFlags.Class) return 'class';
  if (f & ts.SymbolFlags.Interface) return 'interface';
  if (f & ts.SymbolFlags.TypeAlias) return 'type';
  if (f & ts.SymbolFlags.Enum || f & ts.SymbolFlags.EnumMember) return 'enum';
  return 'const';
}

/** The first sentence-ish paragraph of the doc comment, as plain text. */
function docOf(symbol, checker) {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  if (!text) return '';
  const para = text.split(/\n\s*\n/)[0];
  return para.replace(/\s*\n\s*/g, ' ').trim();
}

/** What to show as the declaration: the call signature for functions, the type for values. */
function signatureOf(symbol, checker) {
  const decl = symbol.declarations?.[0];
  if (!decl) return symbol.getName();
  const kind = kindOf(symbol);
  if (kind === 'interface' || kind === 'type' || kind === 'class' || kind === 'enum') {
    const params = decl.typeParameters?.length ? `<${decl.typeParameters.map((p) => p.getText()).join(', ')}>` : '';
    return `${symbol.getName()}${params}`;
  }
  const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
  const calls = type.getCallSignatures();
  if (calls.length) {
    return calls
      .map((sig) => {
        const params = sig.getParameters().map((p) => {
          const pd = p.valueDeclaration;
          const optional = pd && ts.isParameter(pd) && (pd.questionToken || pd.initializer) ? '?' : '';
          const rest = pd && ts.isParameter(pd) && pd.dotDotDotToken ? '...' : '';
          return `${rest}${p.getName()}${optional}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(p, pd ?? decl))}`;
        });
        return `${symbol.getName()}(${params.join(', ')}): ${checker.typeToString(sig.getReturnType())}`;
      })
      .join('\n');
  }
  return `${symbol.getName()}: ${checker.typeToString(type)}`;
}

/** Every public entry point with its exported symbols, grouped by kind. */
export function buildApi() {
  const files = ENTRIES.map((e) => join(root, e.file));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  return ENTRIES.map((entry) => {
    const source = program.getSourceFile(join(root, entry.file));
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    const items = exported
      .filter((s) => !s.getName().startsWith('_'))
      .map((s) => {
        const alias = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
        return { name: s.getName(), kind: kindOf(alias), doc: docOf(alias, checker) || docOf(s, checker), signature: signatureOf(alias, checker) };
      })
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
    // `rerender-lens/setup` exports nothing: importing it is the API.
    return { ...entry, items, sideEffect: items.length === 0 };
  });
}

/** The version the docs are built from. */
export const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
