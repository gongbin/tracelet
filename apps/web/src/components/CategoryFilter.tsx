import { PART_CATEGORIES, allParts } from '@tracelet/kernel';
import { usePrefs, useT } from '../i18n/index.js';

export const iconUrl = (id: string, style: 'linear' | 'solid-45' = 'linear') => `${import.meta.env.BASE_URL}component-icons/${style}/${id}.svg`;

/** 元器件分类筛选：紧凑下拉框（侧栏）、图标 chip 或卡片（库页）。 */
export function CategoryFilter({ value, onChange, variant = 'chips', onlyUsed = true }: { value: string | null; onChange: (id: string | null) => void; variant?: 'select' | 'chips' | 'cards'; onlyUsed?: boolean }) {
  const en = usePrefs((s) => s.locale) === 'en'; const t = useT();
  const label = (c: { name: string; en: string }) => (en ? c.en : c.name);
  const group = (c: { group: string; groupEn: string }) => (en ? c.groupEn : c.group);
  const used = new Set(allParts().map((p) => p.category));
  const cats = PART_CATEGORIES.filter((c) => !onlyUsed || used.has(c.id));
  if (variant === 'select') {
    return (
      <select className="field category-select" aria-label={t('lib.all')} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} onKeyDown={(e) => e.stopPropagation()}>
        <option value="">{t('lib.all')}</option>
        {cats.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
      </select>
    );
  }
  if (variant === 'cards') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
        <div className={`cat-card${value === null ? ' on' : ''}`} onClick={() => onChange(null)}><span style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>∗</span><span className="xs">全部</span></div>
        {cats.map((c) => (
          <div key={c.id} className={`cat-card${value === c.id ? ' on' : ''}`} onClick={() => onChange(value === c.id ? null : c.id)} title={group(c)}>
            <span className="cat-icon" style={{ width: 40, height: 40, ['--icon' as string]: `url(${iconUrl(c.id, 'solid-45')})` }} />
            <span className="xs">{label(c)}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span className={`cat-chip${value === null ? ' on' : ''}`} onClick={() => onChange(null)}>∗ {t('all')}</span>
      {cats.map((c) => (
        <span key={c.id} className={`cat-chip${value === c.id ? ' on' : ''}`} onClick={() => onChange(value === c.id ? null : c.id)} title={`${group(c)} · ${label(c)}`}>
          <span className="cat-icon" style={{ width: 16, height: 16, ['--icon' as string]: `url(${iconUrl(c.id)})` }} />{label(c)}
        </span>
      ))}
    </div>
  );
}
