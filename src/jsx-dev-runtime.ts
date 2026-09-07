import * as Runtime from 'react/jsx-dev-runtime';
import { resolveType } from './tracker';

export type { JSX } from 'react/jsx-dev-runtime';
export const Fragment: typeof Runtime.Fragment = Runtime.Fragment;

type JsxDevFn = typeof Runtime.jsxDEV;

export const jsxDEV: JsxDevFn = (type, props, key, isStatic, source, self) =>
  Runtime.jsxDEV(resolveType(type), props, key, isStatic, source, self);
