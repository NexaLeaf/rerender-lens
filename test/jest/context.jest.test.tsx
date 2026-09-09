/**
 * A context provider whose value is a new object literal every render: every consumer re-renders,
 * even the memoized ones, even though nothing in the value changed.
 */
import { describe, expect, it } from '@jest/globals';
import { createContext, memo, useContext, useState } from 'react';
import { mount, run } from './helpers';
import { lens } from './setup';

interface Theme {
  color: string;
}
const ThemeContext = createContext<Theme>({ color: 'black' });
ThemeContext.displayName = 'ThemeContext';

const Label = memo(function Label() {
  const theme = useContext(ThemeContext);
  return <p style={{ color: theme.color }}>label</p>;
});
Label.displayName = 'Label';

let bump = (): void => {};

function App() {
  const [count, setCount] = useState(0);
  bump = () => setCount((n) => n + 1);
  return (
    // A new value object every render: nothing changed, but every consumer is told it did.
    <ThemeContext.Provider value={{ color: 'black' }}>
      <span data-testid="count">{count}</span>
      <Label />
    </ThemeContext.Provider>
  );
}

describe('a context value rebuilt on every render', () => {
  it('re-renders the memoized consumer for nothing', () => {
    const before = lens.collector.avoidable.length;
    const app = mount(<App />);
    run(bump);
    expect(app.container.querySelector('[data-testid="count"]')!.textContent).toBe('1');

    const added = lens.collector.avoidable.slice(before);
    expect(added.map((r) => r.component)).toEqual(['Label']);
    expect(added[0]!.hookChanges.map((c) => `${c.path} ${c.kind}`)).toEqual(['useContext(ThemeContext) deep-equal']);
    expect(added[0]!.reasons.join(' ')).toMatch(/memoize the context\/store value/);
    app.unmount();
  });
});
