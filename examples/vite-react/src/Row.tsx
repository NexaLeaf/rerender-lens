export function Row(props: { label: string }) {
  return (
    <div className="card">
      {props.label} <span className="hint">(tracked via include, no memo)</span>
    </div>
  );
}
