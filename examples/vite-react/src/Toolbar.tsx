import { memo, type CSSProperties } from 'react';

export const Toolbar = memo(function Toolbar(props: { style: CSSProperties; title: string }) {
  return (
    <div className="card" style={props.style}>
      <strong>{props.title}</strong> <span className="hint">(memo, inline style prop)</span>
    </div>
  );
});
