import * as Runtime from 'react/jsx-runtime';
import { resolveType } from './tracker';

export type { JSX } from 'react/jsx-runtime';
export const Fragment: typeof Runtime.Fragment = Runtime.Fragment;

type JsxFn = typeof Runtime.jsx;

export const jsx: JsxFn = (type, props, key) => Runtime.jsx(resolveType(type), props, key);
export const jsxs: JsxFn = (type, props, key) => Runtime.jsxs(resolveType(type), props, key);
