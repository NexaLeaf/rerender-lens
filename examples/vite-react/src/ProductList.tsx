import { memo, useState } from 'react';

export interface Product {
  id: number;
  name: string;
  price: number;
}

export const ProductList = memo(function ProductList(props: { products: Product[]; onSelect: (id: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="card">
      <span className="hint">ProductList (memo, inline onSelect prop)</span>
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
