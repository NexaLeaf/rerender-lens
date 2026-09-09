/**
 * The other half of the promise: a memoized child with stable props must produce no report at all,
 * so a budget of zero for it stays green.
 */
import { describe, expect, it } from '@jest/globals';
import { memo, useCallback, useState } from 'react';
import { mount, run } from './helpers';
import { lens } from './setup';

const ITEM = { label: 'stable' }; // hoisted, so the reference never changes

const Card = memo(function Card({ item, onPick }: { item: { label: string }; onPick: () => void }) {
  return (
    <button onClick={onPick} data-testid="card">
      {item.label}
    </button>
  );
});
Card.displayName = 'Card';

let bump = (): void => {};

function Screen() {
  const [count, setCount] = useState(0);
  bump = () => setCount((n) => n + 1);
  const onPick = useCallback(() => undefined, []);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <Card item={ITEM} onPick={onPick} />
    </div>
  );
}

describe('a memoized child with stable props', () => {
  it('bails out, and rerender-lens reports nothing', () => {
    const before = lens.collector.reports.length;
    const app = mount(<Screen />);
    run(bump);
    run(bump);
    expect(app.container.querySelector('[data-testid="count"]')!.textContent).toBe('2');
    expect(lens.collector.reports.slice(before)).toEqual([]);
    app.unmount();
  });
});
