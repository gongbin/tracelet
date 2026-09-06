/** 品牌标记：用 currentColor 画，跟随主题（浅色下为深色，深色下为浅色），不再依赖白色 SVG 文件。 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label="Tracelet" style={{ display: 'block', color: 'var(--text)' }}>
      <g fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round"><path d="M15 48L29 24H44.333" /><path d="M19.667 40H35L49 16" /></g>
      <g fill="currentColor"><circle cx="15" cy="48" r="5" /><circle cx="49" cy="16" r="5" /></g>
    </svg>
  );
}
