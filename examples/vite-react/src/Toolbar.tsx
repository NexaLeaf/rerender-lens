import { memo, type CSSProperties } from 'react';

export const Toolbar = memo(function Toolbar(props: { style: CSSProperties; title: string }) {
  return (
    <div className="card" style={props.style}>
      <strong>{props.title}</strong> <span className="hint">(memo, inline style prop)</span>
    </div>
  );
});
// The dev transform renames the inner function (Toolbar2); give the memo a stable name.
Toolbar.displayName = 'Toolbar';
