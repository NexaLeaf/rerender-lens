// @vitest-environment node
// Pure module, and esbuild (the "against a real bundle" case) cannot run under jsdom: its TextEncoder
// does not produce a real Uint8Array.
import { describe, expect, it } from 'vitest';
import { decodeDataUrl, decodeVlq, identifierOffset, lookupPosition, offsetToPosition, parseSourceMap, sourceMappingURL } from '../src/sourcemap';

/**
 * Hand-written fixture. Base64 VLQ: a value is `(abs << 1) | sign`, then base64.
 *
 * line 0: [0,0,0,0,0]  "AAAAA"  → col 0    → src/Row.tsx 0:0, name "Row"
 *         [10,0,2,4]   "UAEI"   → col 10   → src/Row.tsx 2:4, no name
 *         [2]          "E"      → col 12   → generated only (a 1-field segment)
 * line 1: ""                    → no mappings at all
 * line 2: [4,0,-1,0,1] "IADAC"  → col 4    → src/Row.tsx 1:4, name "Cell" (negative line delta)
 */
const FIXTURE = {
  version: 3,
  file: 'app.js',
  sources: ['src/Row.tsx'],
  names: ['Row', 'Cell'],
  mappings: 'AAAAA,UAEI,E;;IADAC',
};

describe('base64 VLQ', () => {
  it('decodes single and continued digits, and negative values', () => {
    expect(decodeVlq('A')).toEqual({ value: 0, next: 1 });
    expect(decodeVlq('U')).toEqual({ value: 10, next: 1 });
    expect(decodeVlq('D')).toEqual({ value: -1, next: 1 });
    // "gBC" = 0b100000 (continued, 0) then 2 → 1 << 5 ... = 33 → value 16 after the sign bit.
    const long = decodeVlq('gBC');
    expect(long).toEqual({ value: 16, next: 2 });
    // Reading from an offset, and stopping cleanly at the end of the text.
    expect(decodeVlq('AAAAA', 4)).toEqual({ value: 0, next: 5 });
    expect(decodeVlq('', 0)).toBeNull();
    expect(decodeVlq('g')).toBeNull(); // continuation bit with nothing after it
    expect(decodeVlq('!')).toBeNull();
  });
});

describe('parseSourceMap', () => {
  it('parses the grid, keeping empty lines and 1/4/5-field segments', () => {
    const map = parseSourceMap(JSON.stringify(FIXTURE))!;
    expect(map.sources).toEqual(['src/Row.tsx']);
    expect(map.names).toEqual(['Row', 'Cell']);
    expect(map.lines).toHaveLength(3);
    expect(map.lines[0]).toEqual([
      { column: 0, source: 0, line: 0, sourceColumn: 0, name: 0 },
      { column: 10, source: 0, line: 2, sourceColumn: 4, name: -1 },
      { column: 12, source: -1, line: -1, sourceColumn: -1, name: -1 },
    ]);
    expect(map.lines[1]).toEqual([]);
    // Negative deltas: the original line went 2 → 1, and the name index moved to 1.
    expect(map.lines[2]).toEqual([{ column: 4, source: 0, line: 1, sourceColumn: 4, name: 1 }]);
  });

  it('applies sourceRoot and refuses maps it cannot use', () => {
    expect(parseSourceMap({ ...FIXTURE, sourceRoot: 'webpack://app' })!.sources).toEqual(['webpack://app/src/Row.tsx']);
    expect(parseSourceMap('not json')).toBeNull();
    expect(parseSourceMap({ version: 3, sources: [] })).toBeNull(); // no mappings
    expect(parseSourceMap({ version: 3, sections: [] })).toBeNull(); // index map
  });
});

describe('lookupPosition', () => {
  const map = parseSourceMap(FIXTURE)!;

  it('returns the name at an exact hit', () => {
    expect(lookupPosition(map, 0, 0)).toEqual({ source: 'src/Row.tsx', line: 0, column: 0, name: 'Row' });
    expect(lookupPosition(map, 2, 9)).toEqual({ source: 'src/Row.tsx', line: 1, column: 4, name: 'Cell' });
  });

  it('takes the greatest mapping at or before the column', () => {
    expect(lookupPosition(map, 0, 5)!.name).toBe('Row'); // inside the first segment
    expect(lookupPosition(map, 0, 10)).toEqual({ source: 'src/Row.tsx', line: 2, column: 4, name: null });
    expect(lookupPosition(map, 0, 99)).toEqual({ source: null, line: -1, column: -1, name: null }); // the 1-field segment
  });

  it('returns null out of range, on an empty line and before the first segment', () => {
    expect(lookupPosition(map, 1, 0)).toBeNull(); // the empty generated line
    expect(lookupPosition(map, 2, 3)).toBeNull(); // before the line's first segment; never carried over from line 1
    expect(lookupPosition(map, 7, 0)).toBeNull(); // past the last generated line
    expect(lookupPosition(map, -1, 0)).toBeNull();
  });
});

describe('offsets, identifiers and sourceMappingURL', () => {
  it('turns a character offset into a generated line/column', () => {
    const text = 'a\nbcd\n\nef';
    expect(offsetToPosition(text, 0)).toEqual({ line: 0, column: 0 });
    expect(offsetToPosition(text, 3)).toEqual({ line: 1, column: 1 });
    expect(offsetToPosition(text, 6)).toEqual({ line: 2, column: 0 });
    expect(offsetToPosition(text, 8)).toEqual({ line: 3, column: 1 });
    expect(offsetToPosition(text, 500)).toEqual({ line: 3, column: 2 }); // clamped to the end
  });

  it('finds the identifier of a function, and only of a named one', () => {
    expect(identifierOffset('function ed(e){return e}')).toBe(9);
    expect(identifierOffset('function* gen(){}')).toBe(10);
    expect(identifierOffset('async function fd(){}')).toBe(15);
    expect(identifierOffset('class Ou extends X{}')).toBe(6);
    // Nothing to look up: an arrow, or a name the minifier dropped (the `memo(function(){})` case).
    expect(identifierOffset('e=>e.a')).toBeNull();
    expect(identifierOffset('(a,b)=>{return a}')).toBeNull();
    expect(identifierOffset('function (e){}')).toBeNull();
  });

  it('resolves the last sourceMappingURL against the bundle URL', () => {
    const bundle = 'x=1\n//# sourceMappingURL=old.map\ny=2\n//# sourceMappingURL=app.js.map\n';
    expect(sourceMappingURL(bundle, 'https://site.test/assets/app.js')).toBe('https://site.test/assets/app.js.map');
    expect(sourceMappingURL('x=1\n')).toBeNull();
    expect(sourceMappingURL('x=1\n//# sourceMappingURL=data:application/json;base64,e30=', 'https://site.test/a.js')).toBe('data:application/json;base64,e30=');
  });

  it('decodes an inline map, base64 or percent-encoded', () => {
    const json = JSON.stringify(FIXTURE);
    const base64 = Buffer.from(json, 'utf8').toString('base64');
    expect(decodeDataUrl(`data:application/json;charset=utf-8;base64,${base64}`)).toBe(json);
    expect(decodeDataUrl(`data:application/json,${encodeURIComponent(json)}`)).toBe(json);
    expect(decodeDataUrl('https://site.test/app.js.map')).toBeNull();
    expect(decodeDataUrl('data:application/json;base64')).toBeNull();
  });
});

// The whole method end to end against a real minifier, rather than a fixture: minify a module, take the
// minified function's own `toString()` (what the page bridge's `functionSource` returns) and map it back.
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { path: string; text: string }[] }>;
}
let esbuild: Esbuild | null = null;
try {
  esbuild = (await import('esbuild')) as unknown as Esbuild;
} catch {
  esbuild = null; // only a transitive dependency (tsup); the fixture tests above are the contract
}

describe.skipIf(!esbuild)('against a real bundle', () => {
  it('names a minified function through the bundle its source map', async () => {
    const source = 'function Row(props) {\n  return props.a + props.b;\n}\nfunction App(props){ return Row(props) + 1 }\nwindow.__app = App;\n';
    const out = await esbuild!.build({
      stdin: { contents: source, sourcefile: 'src/Row.tsx', loader: 'js' },
      bundle: true,
      minify: true,
      format: 'iife',
      sourcemap: 'external',
      write: false,
      outfile: 'app.js',
    });
    const code = out.outputFiles.find((f) => f.path.endsWith('app.js'))!.text;
    const map = parseSourceMap(out.outputFiles.find((f) => f.path.endsWith('.map'))!.text)!;

    // Run the bundle and take the component out of it, exactly as the page hands it to `functionSource`.
    const win: Record<string, unknown> = {};
    new Function('window', code)(win);
    const text = Function.prototype.toString.call(win.__app as () => unknown);
    expect(text).not.toContain('App'); // the identifier really was minified away

    const at = code.indexOf(text);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(code.lastIndexOf(text)).toBe(at); // unambiguous
    const offset = identifierOffset(text)!;
    const pos = offsetToPosition(code, at + offset);
    const original = lookupPosition(map, pos.line, pos.column)!;
    expect(original.name).toBe('App');
    expect(original.source).toContain('Row.tsx');
  });
});
