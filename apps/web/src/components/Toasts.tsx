import { useApp } from '../store/app.js';
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ''}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'error' ? <span style={{ color: 'var(--error)' }}>●</span> : t.kind === 'success' ? <span style={{ color: 'var(--success)' }}>✓</span> : <span style={{ color: 'var(--accent)' }}>●</span>}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
