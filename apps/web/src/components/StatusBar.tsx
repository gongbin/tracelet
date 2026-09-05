export interface StatusItem { text: string; color?: string; onClick?: () => void }
export function StatusBar({ items, zoom }: { items: StatusItem[]; zoom?: number }) {
  return (
    <div className="statusbar">
      {items.map((s, i) => (
        <span key={i} className="item" style={{ color: s.color }} onClick={s.onClick}>{s.text}</span>
      ))}
      <span className="ml-auto" style={{ padding: '0 4px' }}>{zoom !== undefined ? `${Math.round(zoom * 100)}%` : ''}</span>
    </div>
  );
}
