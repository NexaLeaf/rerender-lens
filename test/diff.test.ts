import { describe, expect, it } from 'vitest';
import React from 'react';
import { classify, deepEqual, diffRecords, firstDifferentPath } from '../src/diff';

describe('deepEqual', () => {
  it('handles primitives and NaN', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });
  it('compares plain objects and arrays structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
  it('compares Map, Set, Date, RegExp and typed arrays', () => {
    expect(deepEqual(new Map([['k', { v: 1 }]]), new Map([['k', { v: 1 }]]))).toBe(true);
    expect(deepEqual(new Map([['k', 1]]), new Map([['k', 2]]))).toBe(false);
    expect(deepEqual(new Set([{ a: 1 }, 2]), new Set([2, { a: 1 }]))).toBe(true);
    expect(deepEqual(new Set([1]), new Set([2]))).toBe(false);
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(new Date(5), new Date(6))).toBe(false);
    expect(deepEqual(/a/g, /a/g)).toBe(true);
    expect(deepEqual(/a/g, /a/i)).toBe(false);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });
  it('compares React elements by type, key and props', () => {
    const A = () => null;
    expect(deepEqual(React.createElement(A, { x: [1] }), React.createElement(A, { x: [1] }))).toBe(true);
    expect(deepEqual(React.createElement(A, { x: 1 }), React.createElement(A, { x: 2 }))).toBe(false);
    expect(deepEqual(React.createElement('div', { key: 'a' }), React.createElement('div', { key: 'b' }))).toBe(false);
  });
  it('treats functions and class instances by reference', () => {
    const f = () => 1;
    expect(deepEqual(f, f)).toBe(true);
    expect(deepEqual(() => 1, () => 1)).toBe(false);
    class C { x = 1; }
    expect(deepEqual(new C(), new C())).toBe(false);
  });
  it('survives cycles', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    const b: Record<string, unknown> = { n: 1 };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
    const c: Record<string, unknown> = { n: 2 };
    c.self = c;
    expect(deepEqual(a, c)).toBe(false);
  });
});

describe('classify', () => {
  it('names function, element, deep-equal and different', () => {
    expect(classify(() => 1, () => 1)).toBe('function');
    expect(classify(function foo() {}, function bar() {})).toBe('different');
    const A = () => null;
    expect(classify(React.createElement(A, { a: 1 }), React.createElement(A, { a: 1 }))).toBe('element');
    expect(classify(React.createElement(A, { a: 1 }), React.createElement(A, { a: 2 }))).toBe('different');
    expect(classify({ a: 1 }, { a: 1 })).toBe('deep-equal');
    expect(classify({ a: 1 }, { a: 2 })).toBe('different');
  });
});

describe('diffRecords', () => {
  it('reports added/removed/changed keys with nested paths', () => {
    const f = () => 1;
    const changes = diffRecords(
      { a: 1, b: { c: [1, 2] }, gone: 1, same: f, style: { color: 'red' } },
      { a: 1, b: { c: [1, 3] }, fresh: 1, same: f, style: { color: 'red' } },
    );
    expect(changes).toEqual([
      { path: 'b.c[1]', kind: 'different', prev: { c: [1, 2] }, next: { c: [1, 3] } },
      { path: 'gone', kind: 'removed', prev: 1, next: undefined },
      { path: 'style', kind: 'deep-equal', prev: { color: 'red' }, next: { color: 'red' } },
      { path: 'fresh', kind: 'added', prev: undefined, next: 1 },
    ]);
  });
  it('handles null/undefined records', () => {
    expect(diffRecords(null, undefined)).toEqual([]);
    expect(diffRecords(undefined, { a: 1 })[0]?.kind).toBe('added');
  });
  it('quotes non-identifier keys', () => {
    expect(firstDifferentPath({ 'data-x': { y: 1 } }, { 'data-x': { y: 2 } }, 'p')).toBe('p["data-x"].y');
    expect(firstDifferentPath([1, 2], [1, 2, 3], 'arr')).toBe('arr.length');
  });
});
