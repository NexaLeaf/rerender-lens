import { useEffect, useRef } from 'react';
import type { Options } from './types';
import { diffRecords } from './diff';
import { buildReport } from './report';
import { dispatch, getState } from './state';

type HookOptions = Pick<Options, 'notifier' | 'silent' | 'console' | 'collapse' | 'logAll'>;

/**
 * Track one component from the inside, without patching React:
 *
 * ```ts
 * function Row(props) {
 *   useWhyRerender('Row', props);
 *   ...
 * }
 * ```
 *
 * Pass any object of values you care about (props, selected state, context values).
 * Reports go to the console and to the notifier configured via `init`, or to
 * `options.notifier` when given.
 */
export function useWhyRerender(name: string, values: Record<string, unknown>, options?: HookOptions): void {
  const ref = useRef<{ committed: Record<string, unknown> | null; reported: boolean; count: number }>({
    committed: null,
    reported: false,
    count: 0,
  });
  const st = ref.current;
  // Compare against the last *committed* values. StrictMode renders twice before a
  // commit; `reported` makes sure the second pass does not produce a duplicate.
  if (st.committed && !st.reported) {
    st.reported = true;
    st.count++;
    const propChanges = diffRecords(st.committed, values);
    dispatch(
      buildReport({
        component: name,
        renderCount: st.count,
        prevProps: st.committed,
        nextProps: values,
        propChanges,
      }),
      options ? { ...getState().options, ...options } : undefined,
    );
  }
  useEffect(() => {
    st.committed = values;
    st.reported = false;
  });
}
