import { useState } from 'react';
import { ProductList } from './ProductList';
import { Toolbar } from './Toolbar';
import { Row } from './Row';

const PRODUCTS = [
  { id: 1, name: 'Keyboard', price: 49 },
  { id: 2, name: 'Mouse', price: 25 },
  { id: 3, name: 'Monitor', price: 299 },
];

export function App() {
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);

  return (
    <>
      <h1>rerender-lens example</h1>
      <p className="hint">Open the console. Every avoidable re-render prints a collapsed group explaining the fix.</p>

      <div className="card">
        <label>
          Search (typing re-renders App):{' '}
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>{' '}
        <button onClick={() => setTick((t) => t + 1)}>Re-render App ({tick})</button>
      </div>

      {/* Bug 1: inline object prop defeats React.memo on Toolbar */}
      <Toolbar style={{ marginBottom: 8 }} title="Products" />

      {/* Bug 2: inline callback defeats React.memo on ProductList */}
      <ProductList products={PRODUCTS} onSelect={(id) => console.log('selected', id)} />

      {/* Bug 3: Row is not memoized, so it re-renders with identical props */}
      <Row label="Static row (not memoized)" />
    </>
  );
}
