/**
 * The classic avoidable re-render: a memoized row that gets a fresh object and a fresh callback on
 * every parent render. Each list update re-renders every row for nothing.
 */
import { describe, expect, it } from '@jest/globals';
import { memo, useState } from 'react';
import { mount, run } from './helpers';
import { lens } from './setup';

const Row = memo(function Row({ item, onPick }: { item: { label: string }; onPick: () => void }) {
  return (
    <li onClick={onPick} data-testid="row">
      {item.label}
    </li>
  );
});
Row.displayName = 'Row';

const LABELS = ['alpha', 'beta', 'gamma'];

let bump = (): void => {};

function List() {
  const [count, setCount] = useState(0);
  bump = () => setCount((n) => n + 1);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <ul>
        {LABELS.map((label) => (
          // Both props are new on every render, so React.memo never bails out.
          <Row key={label} item={{ label }} onPick={() => undefined} />
        ))}
      </ul>
    </div>
  );
}

describe('a memoized row with unstable props', () => {
  it('re-renders every row when only the counter changed', () => {
    const before = lens.collector.avoidable.length;
    const app = mount(<List />);
    expect(app.container.querySelectorAll('[data-testid="row"]')).toHaveLength(3);

    run(bump);
    expect(app.container.querySelector('[data-testid="count"]')!.textContent).toBe('1');

    const added = lens.collector.avoidable.slice(before);
    expect(added).toHaveLength(3);
    expect(added.every((r) => r.component === 'Row')).toBe(true);
    // A new object with the same contents, and a new function with the same body.
    expect(added[0]!.propChanges.map((c) => c.kind).sort()).toEqual(['deep-equal', 'function']);
    app.unmount();
  });

  it('does the same on a fresh mount: two more updates, six more avoidable renders', () => {
    const app = mount(<List />);
    run(bump);
    run(bump);
    expect(lens.collector.avoidable.filter((r) => r.component === 'Row')).toHaveLength(9);
    app.unmount();
  });
});
