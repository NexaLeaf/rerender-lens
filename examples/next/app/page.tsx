'use client';
// The same three avoidable re-renders as examples/vite-react, in a Next.js App Router page.
// rerender-lens starts from instrumentation-client.ts; open the relay panel (`npx rerender-lens
// panel --port 4142`, then http://127.0.0.1:4142/) to see them.
import { memo, useState, type CSSProperties } from 'react';

const card: CSSProperties = { border: '1px solid #ddd', borderRadius: 8, padding: '1rem', margin: '1rem 0' };
const hint: CSSProperties = { color: '#666', fontSize: '0.9em' };

const Toolbar = memo(function Toolbar(props: { style: CSSProperties; title: string }) {
  return (
    <div style={{ ...card, ...props.style }}>
      <strong>{props.title}</strong> <span style={hint}>(memo, inline style prop)</span>
    </div>
  );
});
Toolbar.displayName = 'Toolbar';

const PRODUCTS = [
  { id: 1, name: 'Keyboard', price: 49 },
  { id: 2, name: 'Mouse', price: 25 },
  { id: 3, name: 'Monitor', price: 299 },
];

const ProductList = memo(function ProductList(props: { products: typeof PRODUCTS; onSelect: (id: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div style={card}>
      <span style={hint}>ProductList (memo, inline onSelect prop)</span>
      <ul>
        {props.products.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => {
                setSelected(p.id);
                props.onSelect(p.id);
              }}
            >
              {selected === p.id ? '✓ ' : ''}
              {p.name} — ${p.price}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
ProductList.displayName = 'ProductList';

export default function Page() {
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  return (
    <>
      <h1>rerender-lens Next.js example</h1>
      <p style={hint}>Started from instrumentation-client.ts with one import; reports go to the relay panel.</p>
      <div style={card}>
        <label>
          Search (typing re-renders the page): <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>{' '}
        <button onClick={() => setTick((t) => t + 1)}>Re-render App ({tick})</button>
      </div>
      <Toolbar style={{ marginBottom: 8 }} title="Products" />
      <ProductList products={PRODUCTS} onSelect={(id) => console.log('selected', id)} />
    </>
  );
}
