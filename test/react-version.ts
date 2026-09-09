/**
 * What the installed React can do, for the compat runs (`npm run test:react18`, `test:react17`).
 * Guard a test with `describe.skipIf(!HAS_CONTEXT_VALUES)(...)` rather than deleting it: the
 * default run is React 19 and must keep every case.
 */
import React from 'react';

export const REACT_MAJOR = Number(React.version.split('.')[0]) || 0;

/** `useTransition`, `useDeferredValue`, `useId`, `useSyncExternalStore`, `startTransition`. */
export const HAS_REACT18_HOOKS = REACT_MAJOR >= 18;

/**
 * React records the value a component read from a context on the fiber's dependency list
 * (`memoizedValue`) only from 18 on; before that the dependency holds the context alone, so a
 * context change cannot be diffed and shows up as a plain `parent` render.
 */
export const HAS_CONTEXT_VALUES = REACT_MAJOR >= 18;

/** `root.memoizedUpdaters`: who scheduled the commit (and so effect-loop detection). React 18+. */
export const HAS_UPDATERS = REACT_MAJOR >= 18;

/** `use()`, `ref` as a prop, React Compiler's `useMemoCache`. */
export const HAS_REACT19 = REACT_MAJOR >= 19;
