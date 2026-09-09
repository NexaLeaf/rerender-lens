'use client';
// A second app page, so `npx rerender-lens panel` has two apps to choose between: open this and
// `/` at once and the panel's app picker lists both (the label is host + pathname).
import { memo, useState, type CSSProperties } from 'react';

const card: CSSProperties = { border: '1px solid #ddd', borderRadius: 8, padding: '1rem', margin: '1rem 0' };
const hint: CSSProperties = { color: '#666', fontSize: '0.9em' };

const Stat = memo(function Stat(props: { label: string; value: number; style: CSSProperties }) {
  return (
    <div style={{ ...card, ...props.style }}>
      <strong>{props.label}</strong>: {props.value} <span style={hint}>(memo, inline style prop)</span>
    </div>
  );
});
Stat.displayName = 'Stat';

export default function AdminPage() {
  const [tick, setTick] = useState(0);
  return (
    <>
      <h1>rerender-lens admin example</h1>
      <p style={hint}>A second page so the relay panel has two apps to switch between.</p>
      <div style={card}>
        <button onClick={() => setTick((t) => t + 1)}>Re-render Admin ({tick})</button>
      </div>
      <Stat label="Orders" value={42} style={{ marginBottom: 8 }} />
    </>
  );
}
