// Scale test: thousands of memoized rows sharing one large context value and a large typed-array
// prop, all re-rendering avoidably on every parent update. This is the shape of app that froze the
// page before the per-commit budgets; `?rows=N` sets the size (default 3000). The readout shows the
// library's own cost from `info().overhead` and how many reports the cap skipped.
import { createContext, memo, StrictMode, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const rows = Math.max(1, Number(new URLSearchParams(location.search).get('rows')) || 3000);

// A big shared value (like an app-state context): equal contents, new identity on every render.
interface Shared {
  items: { id: number; label: string; tags: string[] }[];
  lookup: Record<string, number>;
}
const SharedContext = createContext<Shared>({ items: [], lookup: {} });
function makeShared(): Shared {
  const items = Array.from({ length: 2000 }, (_, i) => ({ id: i, label: `item ${i}`, tags: ['a', 'b', 'c'] }));
  const lookup: Record<string, number> = {};
  for (const it of items) lookup[it.label] = it.id;
  return { items, lookup };
}
const PIXELS = new Uint8Array(4 * 1024 * 1024);

const Cell = memo(function Cell(props: { i: number; style: { opacity: number }; pixels: Uint8Array; onPick: (i: number) => void }) {
  const shared = useContext(SharedContext);
  return (
    <div className="cell" style={props.style} onClick={() => props.onPick(props.i)}>
      #{props.i} · {shared.items.length} · {props.pixels.length >> 20} MB
    </div>
  );
});
Cell.displayName = 'Cell';

interface Overhead {
  totalMs: number;
  maxCommitMs: number;
}
interface Info {
  commits?: number;
  overhead?: Overhead;
  truncated?: number;
}

function Readout(props: { tick: number }) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    const b = (window as unknown as { __RERENDER_LENS_DEVTOOLS__?: { info(): Info } }).__RERENDER_LENS_DEVTOOLS__;
    // After the commit that rendered this tick has been inspected.
    const t = setTimeout(() => setInfo(b ? b.info() : null), 50);
    return () => clearTimeout(t);
  }, [props.tick]);
  return (
    <pre data-testid="readout">
      {info
        ? `commits ${info.commits ?? 0} · overhead ${info.overhead?.totalMs.toFixed(1) ?? '?'} ms total, worst commit ${info.overhead?.maxCommitMs.toFixed(1) ?? '?'} ms · reports skipped by the cap: ${info.truncated ?? 0}`
        : 'rerender-lens is not running (open / for the plugin setup or enable injection)'}
    </pre>
  );
}

function App() {
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const shared = makeShared(); // new identity per render: every consumer re-renders
  return (
    <SharedContext.Provider value={shared}>
      <h1>rerender-lens scale test</h1>
      <p className="hint">
        {rows} memoized cells, one 2,000-item context value and a 4 MB typed array prop, all re-created on every render. Use <code>?rows=N</code> to change the size.
      </p>
      <div className="card">
        <button onClick={() => setTick((t) => t + 1)}>Re-render everything ({tick})</button>{' '}
        <label>
          Type: <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Readout tick={tick + query.length} />
      </div>
      <div className="grid">
        {Array.from({ length: rows }, (_, i) => (
          <Cell key={i} i={i} style={{ opacity: 1 }} pixels={PIXELS} onPick={(n) => console.log('pick', n)} />
        ))}
      </div>
    </SharedContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
