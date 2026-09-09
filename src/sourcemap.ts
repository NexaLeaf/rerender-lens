/**
 * A minimal source-map reader: enough to answer "what was this generated position called in the source?".
 *
 * It exists for one job (naming minified components in the panel, see `resolveNames` in
 * `extension/src/panel.ts`), so it is deliberately small: base64 VLQ, the `mappings` grid, and a
 * "greatest mapping at or before this generated position" lookup that reads `names` and `sources`.
 * Everything is pure and 0-based (generated line, generated column, original line, original column),
 * exactly like the source-map spec's own numbering.
 *
 * Not supported: index maps (`sections`) — `parseSourceMap` returns null for them.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CODE: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) CODE[B64[i]!] = i;

export interface RawSourceMap {
  version?: number;
  file?: string;
  sourceRoot?: string;
  sources?: (string | null)[];
  names?: string[];
  mappings?: string;
  sections?: unknown[];
}

/** One `mappings` segment. `-1` means the field was absent (a 1-field segment has all three). */
export interface Segment {
  /** Generated column (0-based). */
  column: number;
  /** Index into `sources`, or -1. */
  source: number;
  /** Original line (0-based), or -1. */
  line: number;
  /** Original column (0-based), or -1. */
  sourceColumn: number;
  /** Index into `names`, or -1. */
  name: number;
}

export interface ParsedSourceMap {
  sources: string[];
  names: string[];
  /** Segments per generated line, in column order. Lines with no mappings are empty arrays. */
  lines: Segment[][];
}

export interface OriginalPosition {
  source: string | null;
  /** 0-based. */
  line: number;
  /** 0-based. */
  column: number;
  /** The original identifier, when the segment carries one. */
  name: string | null;
}

/**
 * Decode one base64-VLQ field starting at `start`.
 * Returns the value and the index just after it, or null when the text runs out / is not base64.
 */
export function decodeVlq(text: string, start = 0): { value: number; next: number } | null {
  let result = 0;
  let shift = 1; // 2 ** (5 * n); multiplication, not <<, so a 32-bit overflow cannot flip the sign
  let i = start;
  for (;;) {
    if (i >= text.length) return null;
    const digit = CODE[text[i]!];
    i++;
    if (digit === undefined) return null;
    result += (digit & 31) * shift;
    if ((digit & 32) === 0) break;
    shift *= 32;
  }
  const negative = result % 2 === 1;
  const value = Math.floor(result / 2);
  return { value: negative ? -value : value, next: i };
}

/** Decode a comma-free VLQ run into its fields (`[column, source, line, sourceColumn, name?]`). */
function decodeSegment(text: string): number[] | null {
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    const field = decodeVlq(text, i);
    if (!field) return null;
    out.push(field.value);
    i = field.next;
  }
  return out.length ? out : null;
}

/** Parse a source map (JSON text or the already-parsed object). Returns null when it has no usable `mappings`. */
export function parseSourceMap(input: string | RawSourceMap): ParsedSourceMap | null {
  let raw: RawSourceMap;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as RawSourceMap;
    } catch {
      return null;
    }
  } else raw = input;
  if (!raw || typeof raw !== 'object' || typeof raw.mappings !== 'string') return null;
  const root = typeof raw.sourceRoot === 'string' && raw.sourceRoot ? raw.sourceRoot.replace(/\/?$/, '/') : '';
  const sources = (Array.isArray(raw.sources) ? raw.sources : []).map((s) => (typeof s === 'string' ? root + s : ''));
  const names = (Array.isArray(raw.names) ? raw.names : []).map((n) => (typeof n === 'string' ? n : ''));
  const lines: Segment[][] = [];
  // Only the generated column resets per line; the other four fields keep running across the whole map.
  let source = 0;
  let line = 0;
  let sourceColumn = 0;
  let name = 0;
  for (const text of raw.mappings.split(';')) {
    const segments: Segment[] = [];
    let column = 0;
    // An empty generated line ("" between two semicolons) contributes no segments; so does a stray comma.
    for (const part of text.split(',')) {
      if (!part) continue;
      const fields = decodeSegment(part);
      if (!fields) continue;
      column += fields[0]!;
      const seg: Segment = { column, source: -1, line: -1, sourceColumn: -1, name: -1 };
      if (fields.length >= 4) {
        source += fields[1]!;
        line += fields[2]!;
        sourceColumn += fields[3]!;
        seg.source = source;
        seg.line = line;
        seg.sourceColumn = sourceColumn;
        if (fields.length >= 5) {
          name += fields[4]!;
          seg.name = name;
        }
      }
      segments.push(seg);
    }
    // Defensive: the spec does not require sorted columns and a negative delta can move one backwards.
    segments.sort((a, b) => a.column - b.column);
    lines.push(segments);
  }
  return { sources, names, lines };
}

/**
 * The greatest mapping at or before a generated position, or null when that line has no mapping
 * at or before the column (mappings never carry over from an earlier generated line).
 */
export function lookupPosition(map: ParsedSourceMap, line: number, column: number): OriginalPosition | null {
  const segments = map.lines[line];
  if (!segments || !segments.length) return null;
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.column <= column) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  const seg = segments[found]!;
  return {
    source: seg.source >= 0 ? map.sources[seg.source] ?? null : null,
    line: seg.line,
    column: seg.sourceColumn,
    name: seg.name >= 0 ? map.names[seg.name] ?? null : null,
  };
}

/** Generated line/column (0-based) of a character offset in the generated file. */
export function offsetToPosition(text: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: at - start };
}

/**
 * Offset of a function's own identifier inside `Function.prototype.toString()` output
 * (`function ed(e){…}` → 9, `class ed extends…` → 6), or null when there is none: an arrow, an
 * anonymous function expression, or a `memo(function(){})` whose name the minifier dropped.
 */
export function identifierOffset(functionText: string): number | null {
  const m = /^\s*(?:async\s+)?(?:function\s*\*?\s*|class\s+)([A-Za-z_$][\w$]*)/.exec(functionText);
  if (!m || !m[1]) return null;
  return m[0].length - m[1].length;
}

/** The `//# sourceMappingURL=` of a bundle, absolute against `bundleUrl` (a `data:` URI is returned as is). */
export function sourceMappingURL(bundleText: string, bundleUrl?: string): string | null {
  // Only the last one counts, and only when it is the whole trailing comment.
  const re = /[#@]\s*sourceMappingURL=([^\s'"]+)[ \t]*$/gm;
  let ref: string | null = null;
  for (let m = re.exec(bundleText); m; m = re.exec(bundleText)) ref = m[1] ?? null;
  if (!ref) return null;
  if (ref.startsWith('data:')) return ref;
  if (!bundleUrl) return ref;
  try {
    return new URL(ref, bundleUrl).href;
  } catch {
    return ref;
  }
}

/** Decode a `data:` source map URI (base64 or percent-encoded). Null when it is not one, or is undecodable. */
export function decodeDataUrl(url: string): string | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) {
      const decode = (globalThis as { atob?: (s: string) => string }).atob;
      if (!decode) return null;
      const binary = decode(body);
      // The map is JSON with non-ASCII source content; atob gives bytes, so decode them as UTF-8.
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return typeof TextDecoder === 'function' ? new TextDecoder().decode(bytes) : binary;
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}
