/**
 * In-page overlay used by the DevTools bridge: outlines the DOM nodes of a
 * component (hover/select in the panel) and flashes nodes whose component just
 * re-rendered avoidably. Pure DOM; nothing React-specific.
 */

const ROOT_ID = 'rerender-lens-overlay';

export interface OverlayBox {
  nodes: Element[];
  label: string;
}

interface Layer {
  root: HTMLElement;
  sticky: HTMLElement[];
}

let layer: Layer | null = null;

function ensureLayer(): Layer | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (layer && layer.root.isConnected) return layer;
  let root = document.getElementById(ROOT_ID) as HTMLElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483647',
      overflow: 'visible',
    });
    document.body.appendChild(root);
  }
  layer = { root, sticky: [] };
  return layer;
}

function box(rect: DOMRect, color: string, fill: string, label?: string): HTMLElement {
  const b = document.createElement('div');
  Object.assign(b.style, {
    position: 'absolute',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(rect.width, 2)}px`,
    height: `${Math.max(rect.height, 2)}px`,
    boxSizing: 'border-box',
    border: `2px solid ${color}`,
    background: fill,
    borderRadius: '2px',
  });
  if (label) {
    const tag = document.createElement('span');
    tag.textContent = label;
    Object.assign(tag.style, {
      position: 'absolute',
      left: '-2px',
      top: rect.top > 20 ? '-20px' : '100%',
      font: '11px/16px system-ui, sans-serif',
      color: '#fff',
      background: color,
      padding: '1px 5px',
      borderRadius: '2px',
      whiteSpace: 'nowrap',
    });
    b.appendChild(tag);
  }
  return b;
}

/** Outline nodes until `clearHighlight()` (or the next `highlight`). */
export function highlight(target: OverlayBox | null): void {
  const l = ensureLayer();
  if (!l) return;
  for (const s of l.sticky) s.remove();
  l.sticky = [];
  if (!target) return;
  for (const node of target.nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const b = box(rect, '#1a73e8', 'rgba(26, 115, 232, 0.12)', target.label);
    l.root.appendChild(b);
    l.sticky.push(b);
  }
}

export function clearHighlight(): void {
  highlight(null);
}

/** Flash nodes briefly (used for avoidable re-renders). */
export function flash(target: OverlayBox, duration = 500): void {
  const l = ensureLayer();
  if (!l) return;
  for (const node of target.nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const b = box(rect, '#d93025', 'rgba(217, 48, 37, 0.15)');
    b.style.transition = `opacity ${duration}ms ease-out`;
    l.root.appendChild(b);
    requestAnimationFrame(() => {
      b.style.opacity = '0';
    });
    setTimeout(() => b.remove(), duration + 50);
  }
}

/** Remove the overlay layer entirely. */
export function destroyOverlay(): void {
  if (layer) layer.root.remove();
  layer = null;
}
