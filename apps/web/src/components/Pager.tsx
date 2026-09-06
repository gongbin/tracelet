import { useT } from '../i18n/index.js';

/** 通用翻页条：只有一页时不渲染。page 从 0 开始。 */
export function Pager({ page, count, total, onChange, compact }: { page: number; count: number; total: number; onChange: (p: number) => void; compact?: boolean }) {
  const t = useT();
  if (count <= 1) return null;
  const cur = Math.min(page, count - 1);
  return (
    <div className={`pager${compact ? ' compact' : ''}`} data-no-translate>
      <button className="btn sm" disabled={cur === 0} onClick={() => onChange(cur - 1)}>‹ {t('pager.prev')}</button>
      <span className="xs muted mono">{t('pager.page', { page: cur + 1, count, total })}</span>
      <button className="btn sm" disabled={cur >= count - 1} onClick={() => onChange(cur + 1)}>{t('pager.next')} ›</button>
    </div>
  );
}

/** 列表切页 hook 的最小实现：返回当前页切片；查询变化时由调用方 reset。 */
export function pageSlice<T>(items: T[], page: number, size: number): { shown: T[]; count: number; page: number } {
  const count = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(page, count - 1);
  return { shown: items.slice(p * size, p * size + size), count, page: p };
}
