export interface StatusItem { text: string; color?: string; onClick?: () => void; title?: string; options?: { label: string; value: string }[]; value?: string; onSelect?: (value: string) => void }
export function StatusBar({ items, zoom }: { items: StatusItem[]; zoom?: number }) {
  return (
    <div className="statusbar">
      {items.map((s, i) => s.options ? (
        <label key={i} className="item" style={{ color: s.color, cursor: 'pointer', position: 'relative' }} title={s.title}>
          {s.text}
          <select value={s.value} onChange={(e) => s.onSelect?.(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} aria-label={s.title ?? s.text}>
            {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ) : (
        <span key={i} className="item" style={{ color: s.color, cursor: s.onClick ? 'pointer' : undefined }} onClick={s.onClick} title={s.title}>{s.text}</span>
      ))}
      <span className="ml-auto" style={{ padding: '0 4px' }}>{zoom !== undefined ? `${Math.round(zoom * 100)}%` : ''}</span>
    </div>
  );
}
